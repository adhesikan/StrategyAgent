// Admin Operations Manual — Sprint 2.3.6A
// Admin-only. Serves docs/operations/*.md files with search and role nav.
// DO NOT expose at a public /docs route.

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  BookOpen, Search, ChevronRight, ExternalLink, X, Loader2,
  Code2, Server, Cloud, ShieldCheck, Headphones, FileText, Menu, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocMeta { id: string; title: string; filename: string; number: string | null }
interface DocContent { id: string; title: string; content: string; headings: Array<{ level: number; text: string; anchor: string; line: number }> }
interface SearchResult { docId: string; docTitle: string; section: string; excerpt: string; jumpLink: string; lineNum: number }

// ---------------------------------------------------------------------------
// Role nav
// ---------------------------------------------------------------------------

const ROLES = [
  {
    id: "developer",
    label: "Developer",
    icon: Code2,
    description: "Architecture, APIs, data model, tests",
    docs: ["01", "03", "04", "05", "16"],
  },
  {
    id: "sysadmin",
    label: "System Administrator",
    icon: Server,
    description: "Platform health, jobs, diagnostics, recovery",
    docs: ["09", "10", "11", "14"],
  },
  {
    id: "devops",
    label: "DevOps",
    icon: Cloud,
    description: "Railway, build, deploy, migrations, rollback, scheduling",
    docs: ["02", "03", "09", "13", "14"],
  },
  {
    id: "devsecops",
    label: "DevSecOps",
    icon: ShieldCheck,
    description: "Auth, admin APIs, secrets, logging, data isolation",
    docs: ["12", "02", "10"],
  },
  {
    id: "support",
    label: "Technical Support",
    icon: Headphones,
    description: "Symptoms, UAT, health, troubleshooting",
    docs: ["11", "16", "10", "15"],
  },
];

// ---------------------------------------------------------------------------
// Simple markdown renderer (no dep — just headings + paragraphs + code blocks)
// ---------------------------------------------------------------------------

function renderMarkdown(md: string): string {
  return md
    // Code blocks
    .replace(/```[\w]*\n([\s\S]*?)```/g, (_m, code) =>
      `<pre class="bg-muted/60 rounded p-3 overflow-x-auto text-xs my-3 whitespace-pre-wrap">${escHtml(code)}</pre>`
    )
    // Inline code
    .replace(/`([^`]+)`/g, (_m, code) =>
      `<code class="bg-muted/60 rounded px-1 py-0.5 text-xs font-mono">${escHtml(code)}</code>`
    )
    // Tables (basic)
    .replace(/\|(.+)\|/g, (m) => `<span class="font-mono text-xs">${m}</span>`)
    // H1
    .replace(/^# (.+)$/gm, (_m, t) =>
      `<h1 id="${slug(t)}" class="text-2xl font-bold mt-6 mb-3 scroll-mt-16">${escHtml(t)}</h1>`
    )
    // H2
    .replace(/^## (.+)$/gm, (_m, t) =>
      `<h2 id="${slug(t)}" class="text-lg font-semibold mt-5 mb-2 border-b pb-1 scroll-mt-16">${escHtml(t)}</h2>`
    )
    // H3
    .replace(/^### (.+)$/gm, (_m, t) =>
      `<h3 id="${slug(t)}" class="text-base font-medium mt-4 mb-1 scroll-mt-16">${escHtml(t)}</h3>`
    )
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, (_m, t) => `<strong>${escHtml(t)}</strong>`)
    // Horizontal rule
    .replace(/^---$/gm, `<hr class="my-4 border-border" />`)
    // Blank lines → paragraph breaks
    .replace(/\n{2,}/g, "</p><p class='my-2'>")
    // Wrap remaining lines
    .replace(/^(?!<[hpcodehr])(.+)$/gm, (m) => `<span>${m}</span>`);
}

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
}

// ---------------------------------------------------------------------------
// Search result card
// ---------------------------------------------------------------------------

function SearchResultCard({ result, onOpen }: { result: SearchResult; onOpen: (docId: string, anchor?: string) => void }) {
  return (
    <button
      className="w-full text-left rounded-lg border bg-card hover:bg-accent/30 transition-colors p-3 space-y-1"
      onClick={() => onOpen(result.docId, result.jumpLink)}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileText className="h-3 w-3 shrink-0" />
        <span className="font-medium text-foreground">{result.docTitle}</span>
        <ChevronRight className="h-3 w-3" />
        <span>{result.section}</span>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2">{result.excerpt}</p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminOperationsManualPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery]);

  // Docs list
  const { data: docsData, isLoading: docsLoading } = useQuery<{ docs: DocMeta[]; count: number }>({
    queryKey: ["/api/admin/operations-manual/docs"],
  });

  // Search results
  const { data: searchData, isLoading: searchLoading } = useQuery<{ results: SearchResult[]; count: number }>({
    queryKey: ["/api/admin/operations-manual/search", debouncedQuery],
    queryFn: () => apiRequest("GET", `/api/admin/operations-manual/search?q=${encodeURIComponent(debouncedQuery)}`).then(r => r.json()),
    enabled: debouncedQuery.trim().length >= 2,
  });

  // Selected doc content
  const { data: docData, isLoading: docLoading } = useQuery<DocContent>({
    queryKey: ["/api/admin/operations-manual/docs", selectedDoc],
    queryFn: () => apiRequest("GET", `/api/admin/operations-manual/docs/${selectedDoc}`).then(r => r.json()),
    enabled: !!selectedDoc,
  });

  const docs = docsData?.docs ?? [];

  function openDoc(id: string, anchor?: string) {
    setSelectedDoc(id);
    setSearchQuery("");
    setDebouncedQuery("");
    if (anchor) {
      setTimeout(() => {
        const el = document.getElementById(anchor.replace("#", ""));
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 400);
    } else {
      contentRef.current?.scrollTo({ top: 0 });
    }
  }

  // Role filter
  const roleDoc = selectedRole ? ROLES.find(r => r.id === selectedRole) : null;
  const filteredDocs = roleDoc
    ? docs.filter(d => roleDoc.docs.some(n => d.number === n))
    : docs;

  const isSearchMode = debouncedQuery.trim().length >= 2;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      {sidebarOpen && (
        <aside className="w-72 shrink-0 border-r flex flex-col bg-background overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Operations Manual</span>
              <Badge variant="secondary" className="ml-auto text-xs">{docs.length}</Badge>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="pl-8 h-8 text-xs"
                placeholder="Search all docs…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => { setSearchQuery(""); setDebouncedQuery(""); }}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Role filter */}
          {!isSearchMode && (
            <div className="p-3 border-b space-y-1">
              <p className="text-xs text-muted-foreground font-medium mb-2">Filter by role</p>
              <div className="flex flex-wrap gap-1.5">
                {ROLES.map(role => (
                  <button
                    key={role.id}
                    onClick={() => setSelectedRole(r => r === role.id ? null : role.id)}
                    className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                      selectedRole === role.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background hover:bg-accent border-border"
                    }`}
                  >
                    {role.label}
                  </button>
                ))}
                {selectedRole && (
                  <button
                    onClick={() => setSelectedRole(null)}
                    className="text-xs px-2 py-0.5 rounded-full text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>
              {roleDoc && (
                <p className="text-xs text-muted-foreground mt-1">{roleDoc.description}</p>
              )}
            </div>
          )}

          {/* Content: search results or doc list */}
          <div className="flex-1 overflow-y-auto">
            {isSearchMode ? (
              <div className="p-2 space-y-1">
                {searchLoading && (
                  <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Searching…
                  </div>
                )}
                {!searchLoading && searchData && searchData.results.length === 0 && (
                  <p className="p-3 text-xs text-muted-foreground">No results for "{debouncedQuery}"</p>
                )}
                {!searchLoading && searchData?.results.map((r, i) => (
                  <SearchResultCard key={i} result={r} onOpen={openDoc} />
                ))}
              </div>
            ) : docsLoading ? (
              <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />Loading…
              </div>
            ) : (
              <nav className="p-2 space-y-0.5">
                {filteredDocs.map(doc => (
                  <button
                    key={doc.id}
                    onClick={() => openDoc(doc.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors ${
                      selectedDoc === doc.id
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    }`}
                  >
                    <span className="font-mono text-muted-foreground mr-2">{doc.number ?? "  "}</span>
                    {doc.title}
                  </button>
                ))}
              </nav>
            )}
          </div>

          {/* Footer links */}
          <div className="p-3 border-t space-y-1">
            <Link href="/admin/platform-health">
              <a className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <ExternalLink className="h-3 w-3" />
                Platform Health Dashboard
              </a>
            </Link>
            <a
              href="/api/admin/intelligence/diagnostics"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              Raw Intelligence Diagnostics
            </a>
          </div>
        </aside>
      )}

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSidebarOpen(o => !o)}>
            <Menu className="h-4 w-4" />
          </Button>
          {selectedDoc && (
            <>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className="text-sm font-medium">{docData?.title ?? selectedDoc}</span>
              <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={() => setSelectedDoc(null)}>
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
          {!selectedDoc && (
            <span className="text-sm text-muted-foreground">Select a document →</span>
          )}
        </div>

        {/* Content area */}
        <div ref={contentRef} className="flex-1 overflow-y-auto">
          {!selectedDoc ? (
            /* Landing page */
            <div className="max-w-3xl mx-auto p-6 space-y-8">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Operations Manual</h1>
                  <p className="text-muted-foreground text-sm mt-1">
                    VCP Trader AI — Admin-only technical reference. {docs.length} documents.
                  </p>
                </div>
              </div>

              <Separator />

              {/* Role navigation */}
              <section className="space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Browse by Role</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {ROLES.map(role => {
                    const Icon = role.icon;
                    const roleDocs = docs.filter(d => role.docs.some(n => d.number === n));
                    return (
                      <Card
                        key={role.id}
                        className="cursor-pointer hover:border-primary/40 transition-colors"
                        onClick={() => setSelectedRole(r => r === role.id ? null : role.id)}
                      >
                        <CardHeader className="pb-2">
                          <div className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-primary" />
                            <CardTitle className="text-sm">{role.label}</CardTitle>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <p className="text-xs text-muted-foreground">{role.description}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {roleDocs.slice(0, 4).map(d => (
                              <button
                                key={d.id}
                                className="text-xs text-primary underline underline-offset-2"
                                onClick={e => { e.stopPropagation(); openDoc(d.id); }}
                              >
                                {d.number}
                              </button>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </section>

              <Separator />

              {/* Quick links */}
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Quick Access</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { label: "Troubleshooting Runbook", docId: "11-troubleshooting-runbook" },
                    { label: "Platform Health & Monitoring", docId: "10-monitoring-and-platform-health" },
                    { label: "Sector & Theme Intelligence", docId: "08-sector-theme-intelligence" },
                    { label: "13F Pipeline", docId: "06-institutional-13f-pipeline" },
                    { label: "API & UAT Reference", docId: "16-api-and-uat-reference" },
                    { label: "Sprint Change Log", docId: "17-sprint-change-log" },
                    { label: "Disaster Recovery", docId: "14-disaster-recovery" },
                    { label: "Security & DevSecOps", docId: "12-security-and-devsecops" },
                  ].map(({ label, docId }) => (
                    <button
                      key={docId}
                      onClick={() => openDoc(docId)}
                      className="flex items-center gap-2 text-sm text-left px-3 py-2 rounded-lg border hover:bg-accent/40 transition-colors"
                    >
                      <ChevronRight className="h-3.5 w-3.5 text-primary shrink-0" />
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <Separator />

              {/* All docs list */}
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">All Documents</h2>
                <div className="space-y-1">
                  {docs.map(doc => (
                    <button
                      key={doc.id}
                      onClick={() => openDoc(doc.id)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent/40 transition-colors text-left"
                    >
                      <span className="font-mono text-xs text-muted-foreground w-6 shrink-0">{doc.number}</span>
                      <span className="text-sm">{doc.title}</span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground ml-auto shrink-0" />
                    </button>
                  ))}
                </div>
              </section>

              <div className="pb-12" />
            </div>
          ) : docLoading ? (
            <div className="flex items-center gap-2 p-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : docData ? (
            <div className="max-w-3xl mx-auto">
              {/* Breadcrumb */}
              <div className="flex items-center gap-2 px-6 pt-4 text-xs text-muted-foreground">
                <button onClick={() => setSelectedDoc(null)} className="flex items-center gap-1 hover:text-foreground transition-colors">
                  <ArrowLeft className="h-3 w-3" />
                  Manual
                </button>
                <ChevronRight className="h-3 w-3" />
                <span className="text-foreground font-medium">{docData.title}</span>
              </div>

              {/* Doc content */}
              <article
                className="prose prose-sm dark:prose-invert max-w-none px-6 py-4 text-sm leading-relaxed"
                dangerouslySetInnerHTML={{
                  __html: `<div class="space-y-2">${renderMarkdown(docData.content)}</div>`,
                }}
              />
              <div className="pb-16" />
            </div>
          ) : (
            <div className="p-8 text-sm text-muted-foreground">Document not found.</div>
          )}
        </div>
      </main>
    </div>
  );
}
