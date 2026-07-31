// Admin-only diagnostic endpoint for the MCP integration (spec §20).
// Returns safe data only — never the service token, session IDs, or URLs
// beyond what an admin needs to confirm connectivity.

import type { Express, RequestHandler } from "express";
import { isMcpEnabled } from "../mcp/config";
import { mcpClient } from "../mcp/client";
import { MCP_ALLOWED_TOOLS } from "../mcp/tools";

export function registerMcpStatusRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  isAdmin: RequestHandler,
): void {
  app.get("/api/internal/mcp/status", isAuthenticated, isAdmin, async (_req, res) => {
    const enabled = isMcpEnabled();
    if (!enabled) {
      return res.json({ enabled: false, connected: false, tools: [] });
    }
    let tools: string[] = mcpClient.getKnownToolNames() ?? [];
    let connected = mcpClient.isConnected;
    let error: string | undefined;
    try {
      tools = await mcpClient.listTools();
      connected = true;
    } catch (err: any) {
      connected = mcpClient.isConnected;
      error = err?.code ?? "MCP_UNAVAILABLE";
    }
    res.json({
      enabled,
      connected,
      tools: tools.filter((t) => (MCP_ALLOWED_TOOLS as readonly string[]).includes(t)),
      stats: mcpClient.getStats(),
      ...(error ? { error } : {}),
    });
  });
}
