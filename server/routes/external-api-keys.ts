import type { Express, RequestHandler } from "express";
import { z } from "zod";
import {
  createExternalApiClient,
  createExternalApiKey,
  ExternalApiSecurityError,
  listExternalApiClients,
  listExternalApiKeys,
  revokeExternalApiKey,
  updateExternalApiClientPolicy,
} from "../services/external-api-security";

const environmentSchema = z.enum(["live", "test"]).default("live");
const createClientSchema = z.object({
  name: z.string().trim().min(1).max(100),
}).strict();
const createKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  environment: environmentSchema,
  scopes: z.array(z.string().min(1).max(80)).min(1).max(10),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();
const clientPolicySchema = z.object({
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  tier: z.string().trim().min(1).max(40).optional(),
  rateLimitPerMinute: z.number().int().min(1).max(100_000).optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0,
  "At least one policy field is required.",
);

function userId(req: Parameters<RequestHandler>[0]): string {
  return req.session.userId ?? "";
}

function sendError(res: Parameters<RequestHandler>[1], error: unknown): void {
  if (error instanceof ExternalApiSecurityError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }
  console.error("[external-api-keys] request failed:", error);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Unable to manage external API credentials.",
    },
  });
}

export function registerExternalApiKeyRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  isAdmin: RequestHandler,
): void {
  app.get("/api/external-api/clients", isAuthenticated, async (req, res) => {
    try {
      res.json({ clients: await listExternalApiClients(userId(req)) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/external-api/clients", isAuthenticated, async (req, res) => {
    try {
      const parsed = createClientSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: "INVALID_CLIENT", message: "Invalid API client details." },
        });
      }
      const client = await createExternalApiClient({
        userId: userId(req),
        ...parsed.data,
      });
      res.status(201).json({ client });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/external-api/keys", isAuthenticated, async (req, res) => {
    try {
      res.json({ keys: await listExternalApiKeys(userId(req)) });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post(
    "/api/external-api/clients/:clientId/keys",
    isAuthenticated,
    async (req, res) => {
      try {
        const parsed = createKeySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error: { code: "INVALID_API_KEY", message: "Invalid API key details." },
          });
        }
        const created = await createExternalApiKey({
          userId: userId(req),
          clientId: String(req.params.clientId),
          ...parsed.data,
        });
        res.status(201).json({
          id: created.metadata.id,
          key: created.key,
          metadata: created.metadata,
          message: "Save this key now. It will not be shown again.",
        });
      } catch (error) {
        sendError(res, error);
      }
    },
  );

  app.delete(
    "/api/external-api/keys/:keyId",
    isAuthenticated,
    async (req, res) => {
      try {
        const revoked = await revokeExternalApiKey(
          userId(req),
          String(req.params.keyId),
        );
        if (!revoked) {
          return res.status(404).json({
            error: { code: "API_KEY_NOT_FOUND", message: "API key was not found." },
          });
        }
        res.json({ success: true, id: req.params.keyId, status: "REVOKED" });
      } catch (error) {
        sendError(res, error);
      }
    },
  );

  app.patch(
    "/api/admin/external-api/clients/:clientId",
    isAuthenticated,
    isAdmin,
    async (req, res) => {
      try {
        const parsed = clientPolicySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error: {
              code: "INVALID_CLIENT_POLICY",
              message: "Invalid API client policy.",
            },
          });
        }
        const client = await updateExternalApiClientPolicy({
          clientId: String(req.params.clientId),
          ...parsed.data,
        });
        if (!client) {
          return res.status(404).json({
            error: {
              code: "API_CLIENT_NOT_FOUND",
              message: "API client was not found.",
            },
          });
        }
        res.json({ client });
      } catch (error) {
        sendError(res, error);
      }
    },
  );
}