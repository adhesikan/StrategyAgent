import { storage } from "./storage";

const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
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
      }
    }
  } catch (error) {
    console.error("[TokenRefresh] Error in token refresh cycle:", error);
  }
}

export function startTokenRefreshService(): void {
  console.log("[TokenRefresh] Token refresh service started (checking every 30 minutes)");
  setInterval(checkAndRefreshTokens, REFRESH_INTERVAL_MS);
  setTimeout(checkAndRefreshTokens, 10000);
}
