import express from "express";
import type { RequestHandler } from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { registerExternalApiKeyRoutes } from "../external-api-keys";
import {
  ensureExternalApiSecuritySchema,
  verifyExternalApiKey,
} from "../../services/external-api-security";

let server: Server;
let baseUrl = "";
const ownerId = `task175-owner-${Date.now()}`;
const otherOwnerId = `task175-other-${Date.now()}`;
let activeOwner = ownerId;

const isAuthenticated: RequestHandler = (req, _res, next) => {
  (req as typeof req & { session: { userId: string } }).session = {
    userId: activeOwner,
  };
  next();
};
const isAdmin: RequestHandler = (_req, res) => {
  res.status(403).json({ message: "Forbidden" });
};

async function jsonRequest(
  path: string,
  init: RequestInit = {},
): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return { response, body: await response.json() };
}

beforeAll(async () => {
  await ensureExternalApiSecuritySchema();
  const app = express();
  app.use(express.json());
  registerExternalApiKeyRoutes(app, isAuthenticated, isAdmin);
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await db.execute(sql`
    DELETE FROM external_api_usage
    WHERE client_id IN (
      SELECT id FROM external_api_clients
      WHERE user_id IN (${ownerId}, ${otherOwnerId})
    )
  `);
  await db.execute(sql`
    DELETE FROM external_api_clients
    WHERE user_id IN (${ownerId}, ${otherOwnerId})
  `);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("external API key lifecycle", () => {
  it("returns a raw key once, persists only its hash, isolates owners, and revokes", async () => {
    activeOwner = ownerId;
    const clientResult = await jsonRequest("/api/external-api/clients", {
      method: "POST",
      body: JSON.stringify({ name: "Lifecycle integration client" }),
    });
    expect(clientResult.response.status).toBe(201);
    const clientId = clientResult.body.client.id as string;
    expect(clientResult.body.client.tier).toBe("standard");

    const keyResult = await jsonRequest(
      `/api/external-api/clients/${clientId}/keys`,
      {
        method: "POST",
        body: JSON.stringify({
          name: "Lifecycle key",
          environment: "test",
          scopes: ["institutional:read"],
        }),
      },
    );
    expect(keyResult.response.status).toBe(201);
    expect(typeof keyResult.body.key).toBe("string");
    const keyId = keyResult.body.id as string;
    const rawKey = keyResult.body.key as string;

    const persisted = await db.execute(sql`
      SELECT key_prefix, key_hash, status
      FROM external_api_keys
      WHERE id = ${keyId}
    `);
    const persistedKey = persisted.rows[0] as Record<string, unknown>;
    expect(persistedKey.key_prefix).toBe(keyResult.body.metadata.keyPrefix);
    expect(persistedKey.key_hash).not.toBe(rawKey);
    expect(await verifyExternalApiKey(rawKey, String(persistedKey.key_hash))).toBe(true);

    const ownerList = await jsonRequest("/api/external-api/keys");
    expect(ownerList.response.status).toBe(200);
    expect(ownerList.body.keys).toHaveLength(1);
    expect(ownerList.body.keys[0].id).toBe(keyId);
    expect(ownerList.body.keys[0]).not.toHaveProperty("key");
    expect(ownerList.body.keys[0]).not.toHaveProperty("keyHash");
    expect(ownerList.body.keys[0]).not.toHaveProperty("key_hash");

    activeOwner = otherOwnerId;
    const otherList = await jsonRequest("/api/external-api/keys");
    expect(otherList.body.keys).toEqual([]);
    const forbiddenRevoke = await jsonRequest(
      `/api/external-api/keys/${keyId}`,
      { method: "DELETE" },
    );
    expect(forbiddenRevoke.response.status).toBe(404);

    activeOwner = ownerId;
    const revoke = await jsonRequest(`/api/external-api/keys/${keyId}`, {
      method: "DELETE",
    });
    expect(revoke.response.status).toBe(200);
    expect(revoke.body.status).toBe("REVOKED");

    const afterRevoke = await jsonRequest("/api/external-api/keys");
    expect(afterRevoke.body.keys[0].status).toBe("REVOKED");
    expect(afterRevoke.body.keys[0].revokedAt).toBeTruthy();
    expect(afterRevoke.body.keys[0]).not.toHaveProperty("key");
  });
});