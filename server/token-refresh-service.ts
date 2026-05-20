import { storage } from "./storage";

// Sweep frequently so a token never silently expires between cycles. The
// per-user check is cheap (a single DB read) and only POSTs to the broker
// when the token is within the expiry buffer.
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const TOKEN_EXPIRY_BUFFER_MS = 2 * 60 * 60 * 1000;

async function refreshTradierToken(userId: string, refreshToken: string): Promise<boolean> {
  const clientId = process.env.TRADIER_CLIENT_ID;
  const clientSecret = process.env.TRADIER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[TokenRefresh] Tradier OAuth credentials not configured");
    return false;
  }

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch("https://api.tradier.com/v1/oauth/accesstoken", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[TokenRefresh] Tradier refresh failed for user ${userId}:`, errorText);
      return false;
    }

    const tokenData = await response.json();
    if (!tokenData.access_token) {
      console.error(`[TokenRefresh] No access token in Tradier refresh response for user ${userId}`);
      return false;
    }

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

    await storage.setBrokerConnectionWithTokens(
      userId,
      "tradier",
      tokenData.access_token,
      tokenData.refresh_token || refreshToken,
      expiresAt,
    );
    await storage.updateBrokerConnectionStatus(userId, true);

    console.log(`[TokenRefresh] Successfully refreshed Tradier token for user ${userId}`);
    return true;
  } catch (error) {
    console.error(`[TokenRefresh] Error refreshing Tradier token for user ${userId}:`, error);
    return false;
  }
}

async function refreshTradeStationToken(userId: string, refreshToken: string): Promise<boolean> {
  const clientId = process.env.TRADESTATION_CLIENT_ID;
  const clientSecret = process.env.TRADESTATION_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[TokenRefresh] TradeStation OAuth credentials not configured");
    return false;
  }

  try {
    const response = await fetch("https://signin.tradestation.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[TokenRefresh] TradeStation refresh failed for user ${userId}:`, errorText);
      return false;
    }

    const tokenData = await response.json();
    if (!tokenData.access_token) {
      console.error(`[TokenRefresh] No access token in TradeStation refresh response for user ${userId}`);
      return false;
    }

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : undefined;

    await storage.setBrokerConnectionWithTokens(
      userId,
      "tradestation",
      tokenData.access_token,
      tokenData.refresh_token || refreshToken,
      expiresAt,
    );
    await storage.updateBrokerConnectionStatus(userId, true);

    console.log(`[TokenRefresh] Successfully refreshed TradeStation token for user ${userId}`);
    return true;
  } catch (error) {
    console.error(`[TokenRefresh] Error refreshing TradeStation token for user ${userId}:`, error);
    return false;
  }
}

async function refreshSchwabToken(userId: string, refreshToken: string): Promise<boolean> {
  const clientId = process.env.SCHWAB_CLIENT_ID;
  const clientSecret = process.env.SCHWAB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[TokenRefresh] Schwab OAuth credentials not configured");
    return false;
  }

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch("https://api.schwabapi.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[TokenRefresh] Schwab refresh failed for user ${userId}:`, errorText);
      // Schwab refresh tokens expire after 7 days — if rejected, mark as requiresReauth.
      if (response.status === 400 || response.status === 401) {
        try { await storage.updateBrokerConnectionStatus(userId, false); } catch {}
      }
      return false;
    }

    const tokenData = await response.json();
    if (!tokenData.access_token) {
      console.error(`[TokenRefresh] No access token in Schwab refresh response for user ${userId}`);
      return false;
    }

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : new Date(Date.now() + 30 * 60 * 1000);

    await storage.setBrokerConnectionWithTokens(
      userId,
      "schwab",
      tokenData.access_token,
      tokenData.refresh_token || refreshToken,
      expiresAt,
    );
    await storage.updateBrokerConnectionStatus(userId, true);

    console.log(`[TokenRefresh] Successfully refreshed Schwab token for user ${userId}`);
    return true;
  } catch (error) {
    console.error(`[TokenRefresh] Error refreshing Schwab token for user ${userId}:`, error);
    return false;
  }
}

// Per-user in-flight dedupe so concurrent /api/broker/ping calls (multiple
// tabs, the 1s heartbeat, parallel queries) share a single refresh attempt
// instead of each posting to the broker in parallel.
const inFlightRefresh = new Map<string, Promise<boolean>>();

// Exposed so other code paths (e.g. /api/broker/ping when a live call returns
// 401 mid-session) can attempt a refresh on demand instead of waiting for the
// background sweep. Returns true on success, false otherwise.
export async function refreshUserBrokerToken(userId: string): Promise<boolean> {
  const existing = inFlightRefresh.get(userId);
  if (existing) return existing;

  const work = (async () => {
    try {
      const fullConnection = await storage.getBrokerConnectionWithToken(userId);
      if (!fullConnection?.refreshToken) return false;
      if (fullConnection.provider === "tradier") {
        return await refreshTradierToken(userId, fullConnection.refreshToken);
      }
      if (fullConnection.provider === "tradestation") {
        return await refreshTradeStationToken(userId, fullConnection.refreshToken);
      }
      if (fullConnection.provider === "schwab") {
        return await refreshSchwabToken(userId, fullConnection.refreshToken);
      }
      return false;
    } catch (err) {
      console.error(`[TokenRefresh] On-demand refresh failed for user ${userId}:`, err);
      return false;
    }
  })();

  inFlightRefresh.set(userId, work);
  try {
    return await work;
  } finally {
    inFlightRefresh.delete(userId);
  }
}

async function checkAndRefreshTokens(): Promise<void> {
  try {
    const connections = await storage.getAutoReconnectConnections();
    if (connections.length === 0) return;

    const now = Date.now();

    for (const connection of connections) {
      const expiresAt = connection.accessTokenExpiresAt
        ? new Date(connection.accessTokenExpiresAt).getTime()
        : null;

      const needsRefresh = !expiresAt || (expiresAt - now) < TOKEN_EXPIRY_BUFFER_MS;

      if (!needsRefresh) continue;

      const fullConnection = await storage.getBrokerConnectionWithToken(connection.userId);
      if (!fullConnection?.refreshToken) {
        console.log(`[TokenRefresh] No refresh token for user ${connection.userId} (${connection.provider}), skipping`);
        continue;
      }

      console.log(`[TokenRefresh] Refreshing ${connection.provider} token for user ${connection.userId}`);

      if (connection.provider === "tradier") {
        await refreshTradierToken(connection.userId, fullConnection.refreshToken);
      } else if (connection.provider === "tradestation") {
        await refreshTradeStationToken(connection.userId, fullConnection.refreshToken);
      } else if (connection.provider === "schwab") {
        await refreshSchwabToken(connection.userId, fullConnection.refreshToken);
      }
    }
  } catch (error) {
    console.error("[TokenRefresh] Error in token refresh cycle:", error);
  }
}

export function startTokenRefreshService(): void {
  console.log(`[TokenRefresh] Token refresh service started (checking every ${REFRESH_INTERVAL_MS / 60000} minutes)`);
  setInterval(checkAndRefreshTokens, REFRESH_INTERVAL_MS);
  setTimeout(checkAndRefreshTokens, 10000);
}
