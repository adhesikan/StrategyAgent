import type { Express } from "express";
import { institutionalApiV1OpenApi } from "../openapi/institutional-api-v1";

/**
 * Documentation is intentionally a public, read-only same-origin JSON
 * resource. It contains only the external contract and no runtime secrets.
 */
export function registerInstitutionalApiV1DocsRoutes(app: Express): void {
  app.get("/api/v1/openapi.json", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    res.setHeader("Vary", "Accept");
    res.type("application/json").status(200).json(institutionalApiV1OpenApi);
  });
}