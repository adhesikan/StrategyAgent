/**
 * Schwab "Advanced BYO Credentials" helpers.
 *
 * Wraps the encrypted user_broker_credentials table for Schwab and provides a
 * single point of resolution so the OAuth init/callback and the token-refresh
 * code can ask: "which client_id/client_secret/redirect_uri should I use for
 * this user, right now?".
 *
 * Secrets are NEVER returned to the frontend — only the masked metadata.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { userBrokerCredentials } from "@shared/schema";
import { encryptToken, decryptToken } from "../crypto";

export type CredentialMode = "platform_credentials" | "user_credentials";

export interface EffectiveSchwabCreds {
  mode: CredentialMode;
  clientId: string;
  clientSecret: string;
  /** Only set when mode='user_credentials'; otherwise the platform callback URL is used. */
  redirectUri: string | null;
}

export interface SchwabByoStatus {
  mode: CredentialMode;
  hasClientId: boolean;
  hasClientSecret: boolean;
  /** Last 4 chars of the saved client ID, prefixed with dots. Empty if none. */
  clientIdMasked: string;
  redirectUri: string | null;
  updatedAt: string | null;
  lastRefreshSuccessAt: string | null;
  reconnectRequired: boolean;
  lastError: string | null;
}

function maskClientId(clientId: string | null): string {
  if (!clientId) return "";
  if (clientId.length <= 4) return "••••";
  return `••••${clientId.slice(-4)}`;
}

async function loadRow(userId: string) {
  const rows = await db
    .select()
    .from(userBrokerCredentials)
    .where(eq(userBrokerCredentials.userId, userId))
    .limit(1);
  return rows[0] || null;
}

function decryptField(ciphertext: string | null, iv: string | null, authTag: string | null): string | null {
  if (!ciphertext || !iv || !authTag) return null;
  try {
    return decryptToken({ ciphertext, iv, authTag });
  } catch (e) {
    console.error("[SchwabByo] Decrypt failed:", (e as Error).message);
    return null;
  }
}

/**
 * Resolve which Schwab credentials to use for a given user. Returns
 * platform-credentials by default; only returns user-credentials when the user
 * has saved a complete (client_id + client_secret + redirect_uri) BYO config
 * AND their mode is set to 'user_credentials'.
 */
export async function getEffectiveSchwabCreds(userId: string): Promise<EffectiveSchwabCreds | null> {
  const platformId = process.env.SCHWAB_CLIENT_ID?.trim();
  const platformSecret = process.env.SCHWAB_CLIENT_SECRET?.trim();

  const row = await loadRow(userId);

  if (row && row.credentialMode === "user_credentials") {
    // Strict mode: if the user explicitly chose BYO, we must NOT silently
    // fall back to platform credentials — that would defeat the user's intent
    // and could surprise them by hitting Schwab with a different client app.
    const clientId = decryptField(row.encryptedClientId, row.clientIdIv, row.clientIdAuthTag);
    const clientSecret = decryptField(row.encryptedClientSecret, row.clientSecretIv, row.clientSecretAuthTag);
    if (clientId && clientSecret && row.redirectUri) {
      return { mode: "user_credentials", clientId, clientSecret, redirectUri: row.redirectUri };
    }
    return null;
  }

  if (platformId && platformSecret) {
    return { mode: "platform_credentials", clientId: platformId, clientSecret: platformSecret, redirectUri: null };
  }

  return null;
}

export async function getSchwabByoStatus(userId: string): Promise<SchwabByoStatus> {
  const row = await loadRow(userId);
  if (!row) {
    return {
      mode: "platform_credentials",
      hasClientId: false,
      hasClientSecret: false,
      clientIdMasked: "",
      redirectUri: null,
      updatedAt: null,
      lastRefreshSuccessAt: null,
      reconnectRequired: false,
      lastError: null,
    };
  }
  const clientId = decryptField(row.encryptedClientId, row.clientIdIv, row.clientIdAuthTag);
  return {
    mode: (row.credentialMode as CredentialMode) ?? "platform_credentials",
    hasClientId: !!row.encryptedClientId,
    hasClientSecret: !!row.encryptedClientSecret,
    clientIdMasked: maskClientId(clientId),
    redirectUri: row.redirectUri,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    lastRefreshSuccessAt: row.lastRefreshSuccessAt ? new Date(row.lastRefreshSuccessAt).toISOString() : null,
    reconnectRequired: !!row.reconnectRequired,
    lastError: row.lastError,
  };
}

export interface SaveSchwabCredsInput {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export async function saveUserSchwabCreds(userId: string, input: SaveSchwabCredsInput): Promise<void> {
  const clientId = input.clientId?.trim();
  const clientSecret = input.clientSecret?.trim();
  const redirectUri = input.redirectUri?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Client ID, Client Secret, and Redirect URI are all required");
  }
  try {
    new URL(redirectUri);
  } catch {
    throw new Error("Redirect URI must be a valid URL");
  }

  const encId = encryptToken(clientId);
  const encSecret = encryptToken(clientSecret);
  const now = new Date();

  const existing = await loadRow(userId);
  if (existing) {
    await db
      .update(userBrokerCredentials)
      .set({
        encryptedClientId: encId.ciphertext,
        clientIdIv: encId.iv,
        clientIdAuthTag: encId.authTag,
        encryptedClientSecret: encSecret.ciphertext,
        clientSecretIv: encSecret.iv,
        clientSecretAuthTag: encSecret.authTag,
        redirectUri,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(userBrokerCredentials.userId, userId));
  } else {
    await db.insert(userBrokerCredentials).values({
      userId,
      provider: "schwab",
      credentialMode: "platform_credentials",
      encryptedClientId: encId.ciphertext,
      clientIdIv: encId.iv,
      clientIdAuthTag: encId.authTag,
      encryptedClientSecret: encSecret.ciphertext,
      clientSecretIv: encSecret.iv,
      clientSecretAuthTag: encSecret.authTag,
      redirectUri,
      reconnectRequired: false,
    });
  }
}

export async function setSchwabCredentialMode(userId: string, mode: CredentialMode): Promise<void> {
  const existing = await loadRow(userId);
  if (!existing) {
    if (mode === "user_credentials") {
      throw new Error("Save your BYO credentials before switching to user_credentials mode");
    }
    return;
  }
  await db
    .update(userBrokerCredentials)
    .set({ credentialMode: mode, updatedAt: new Date() })
    .where(eq(userBrokerCredentials.userId, userId));
}

export async function clearUserSchwabCreds(userId: string): Promise<{ wasUserMode: boolean }> {
  const existing = await loadRow(userId);
  if (!existing) return { wasUserMode: false };
  const wasUserMode = existing.credentialMode === "user_credentials";
  await db
    .delete(userBrokerCredentials)
    .where(eq(userBrokerCredentials.userId, userId));
  return { wasUserMode };
}

export async function markSchwabRefreshSuccess(userId: string): Promise<void> {
  const row = await loadRow(userId);
  if (!row) return;
  await db
    .update(userBrokerCredentials)
    .set({ lastRefreshSuccessAt: new Date(), reconnectRequired: false, lastError: null })
    .where(eq(userBrokerCredentials.userId, userId));
}

export async function markSchwabReconnectRequired(userId: string, errorMessage: string): Promise<void> {
  const row = await loadRow(userId);
  if (!row) return;
  await db
    .update(userBrokerCredentials)
    .set({ reconnectRequired: true, lastError: errorMessage.substring(0, 500) })
    .where(eq(userBrokerCredentials.userId, userId));
}
