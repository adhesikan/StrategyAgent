// Operations Manual Routes — Sprint 2.3.6A
//
// Admin-only access. Serves docs/operations/*.md files and provides
// deterministic full-text search. No LLM. No secrets rendered.
//
// Routes:
//   GET  /api/admin/operations-manual/docs          — list all docs
//   GET  /api/admin/operations-manual/docs/:id      — get a specific doc
//   GET  /api/admin/operations-manual/search?q=     — full-text search

import type { Express, Request, Response } from "express";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOCS_DIR = path.resolve(process.cwd(), "docs/operations");

/** Doc metadata extracted from a .md file. */
interface DocMeta {
  id:       string;           // e.g. "01-system-architecture"
  filename: string;           // e.g. "01-system-architecture.md"
  title:    string;           // first # heading
  number:   string | null;    // "01", "02", ...
  path:     string;           // absolute fs path
}

/** A single search result. */
export interface SearchResult {
  docId:     string;
  docTitle:  string;
  section:   string;          // heading text
  excerpt:   string;          // ~160-char snippet around match
  jumpLink:  string;          // anchor fragment, e.g. #section-title
  lineNum:   number;
}

// ---------------------------------------------------------------------------
// In-memory document index (populated on first access, lightweight)
// ---------------------------------------------------------------------------

let _docsCache: Array<DocMeta & { content: string }> | null = null;
let _docsCacheTime = 0;
const DOCS_CACHE_TTL_MS = 60_000;

async function getDocIndex(): Promise<Array<DocMeta & { content: string }>> {
  if (_docsCache && Date.now() - _docsCacheTime < DOCS_CACHE_TTL_MS) {
    return _docsCache;
  }

  if (!existsSync(DOCS_DIR)) {
    _docsCache = [];
    _docsCacheTime = Date.now();
    return _docsCache;
  }

  const files = (await readdir(DOCS_DIR))
    .filter(f => f.endsWith(".md"))
    .sort();

  const docs: Array<DocMeta & { content: string }> = [];

  for (const filename of files) {
    const filePath = path.join(DOCS_DIR, filename);
    const content  = await readFile(filePath, "utf8");
    const id       = filename.replace(/\.md$/, "");
    const numMatch = filename.match(/^(\d+)-/);
    const titleLine = content.split("\n").find(l => l.startsWith("# "));
    const title     = titleLine ? titleLine.replace(/^#\s+/, "").trim() : id;

    docs.push({
      id,
      filename,
      title,
      number:  numMatch ? numMatch[1] : null,
      path:    filePath,
      content,
    });
  }

  _docsCache = docs;
  _docsCacheTime = Date.now();
  return docs;
}

/** Convert heading text to an anchor fragment. */
function headingToAnchor(heading: string): string {
  return "#" + heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Extract the nearest heading above a given line index. */
function findNearestHeading(lines: string[], lineIdx: number): string {
  for (let i = lineIdx; i >= 0; i--) {
    const m = lines[i].match(/^#{1,3}\s+(.+)/);
    if (m) return m[1].trim();
  }
  return "Document";
}

/** Build a short excerpt around a match, stripping markdown syntax. */
function buildExcerpt(lines: string[], matchLineIdx: number, query: string): string {
  const window = 2;
  const start  = Math.max(0, matchLineIdx - window);
  const end    = Math.min(lines.length - 1, matchLineIdx + window);
  const raw    = lines.slice(start, end + 1).join(" ").replace(/[#*`_\[\]]/g, "").trim();
  const maxLen = 200;
  if (raw.length <= maxLen) return raw;
  const idx = raw.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return raw.slice(0, maxLen) + "…";
  const halfWindow = Math.floor(maxLen / 2);
  const s = Math.max(0, idx - halfWindow);
  const e = Math.min(raw.length, idx + halfWindow);
  return (s > 0 ? "…" : "") + raw.slice(s, e) + (e < raw.length ? "…" : "");
}

/** Full-text search across all docs. */
function searchDocs(
  docs: Array<DocMeta & { content: string }>,
  query: string,
): SearchResult[] {
  if (!query || query.trim().length < 2) return [];
  const q = query.toLowerCase().trim();
  const results: SearchResult[] = [];

  for (const doc of docs) {
    const lines = doc.content.split("\n");
    let lastHeading = doc.title;
    let lastHeadingLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^#{1,3}\s+(.+)/);
      if (headingMatch) {
        lastHeading     = headingMatch[1].trim();
        lastHeadingLine = i;
      }

      if (line.toLowerCase().includes(q)) {
        const section  = findNearestHeading(lines, i);
        const jumpLink = headingToAnchor(section);
        const excerpt  = buildExcerpt(lines, i, q);

        // Avoid duplicate section hits — dedupe by docId+section
        const key = `${doc.id}::${jumpLink}`;
        const alreadyHave = results.some(r => r.docId === doc.id && r.jumpLink === jumpLink && r.lineNum !== i);
        if (!alreadyHave || Math.abs(i - lastHeadingLine) < 5) {
          results.push({
            docId:    doc.id,
            docTitle: doc.title,
            section,
            excerpt,
            jumpLink,
            lineNum:  i + 1,
          });
        }
      }
    }
  }

  // Score: heading matches first, then body
  results.sort((a, b) => {
    const aHead = a.section.toLowerCase().includes(q) ? 0 : 1;
    const bHead = b.section.toLowerCase().includes(q) ? 0 : 1;
    return aHead - bHead || a.lineNum - b.lineNum;
  });

  // Deduplicate by exact (docId, jumpLink) keeping first
  const seen = new Set<string>();
  return results.filter(r => {
    const key = `${r.docId}:${r.jumpLink}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 50);
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerOperationsManualRoutes(
  app: Express,
  isAuthenticated: (req: Request, res: Response, next: () => void) => void,
  isAdmin:         (req: Request, res: Response, next: () => void) => void,
): void {

  // List all docs
  app.get(
    "/api/admin/operations-manual/docs",
    isAuthenticated,
    isAdmin,
    async (_req: Request, res: Response) => {
      try {
        const docs = await getDocIndex();
        res.json({
          docs: docs.map(d => ({
            id:       d.id,
            title:    d.title,
            filename: d.filename,
            number:   d.number,
          })),
          count: docs.length,
        });
      } catch (err: any) {
        console.error("[ops-manual] list error:", err?.message);
        res.status(500).json({ error: "Failed to list docs" });
      }
    },
  );

  // Get a single doc's content
  app.get(
    "/api/admin/operations-manual/docs/:id",
    isAuthenticated,
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        // Security: id must be alphanumeric + hyphens only (no path traversal)
        const { id } = req.params;
        if (!/^[\w-]+$/.test(id)) {
          return res.status(400).json({ error: "Invalid doc id" });
        }
        const docs = await getDocIndex();
        const doc  = docs.find(d => d.id === id);
        if (!doc) return res.status(404).json({ error: "Doc not found" });

        // Build headings list for navigation
        const headings = doc.content.split("\n")
          .map((line, i) => {
            const m = line.match(/^(#{1,3})\s+(.+)/);
            if (!m) return null;
            return { level: m[1].length, text: m[2].trim(), anchor: headingToAnchor(m[2].trim()), line: i + 1 };
          })
          .filter(Boolean);

        res.json({ id: doc.id, title: doc.title, content: doc.content, headings });
      } catch (err: any) {
        console.error("[ops-manual] get doc error:", err?.message);
        res.status(500).json({ error: "Failed to load doc" });
      }
    },
  );

  // Full-text search
  app.get(
    "/api/admin/operations-manual/search",
    isAuthenticated,
    isAdmin,
    async (req: Request, res: Response) => {
      try {
        const q = String(req.query.q ?? "").trim();
        if (!q || q.length < 2) {
          return res.json({ query: q, results: [], count: 0 });
        }
        const docs    = await getDocIndex();
        const results = searchDocs(docs, q);
        res.json({ query: q, results, count: results.length });
      } catch (err: any) {
        console.error("[ops-manual] search error:", err?.message);
        res.status(500).json({ error: "Search failed" });
      }
    },
  );

  // Invalidate cache (admin trigger)
  app.post(
    "/api/admin/operations-manual/refresh",
    isAuthenticated,
    isAdmin,
    async (_req: Request, res: Response) => {
      _docsCache     = null;
      _docsCacheTime = 0;
      const docs = await getDocIndex();
      res.json({ ok: true, docCount: docs.length });
    },
  );
}
