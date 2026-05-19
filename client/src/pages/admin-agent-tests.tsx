// Admin AI Agent Test Suite UI. Lists the seeded question bank, lets admins
// run single / category / all tests, displays graded results, and exports
// runs as JSON or CSV. Lives at /admin/agent-tests and is gated by
// <AdminOnly> in client/src/App.tsx.

import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Play, Database, Download, Beaker, ChevronDown, ChevronRight, AlertTriangle, Sparkles, BookOpen, Star, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AgentTestQuestion, AgentTestRun, AgentReferenceAnswer } from "@shared/schema";

type ValidationJson = {
  score?: number;
  passFail?: string;
  missingConcepts?: string[];
  incorrectStatements?: string[];
  complianceIssues?: string[];
  suggestedImprovedAnswer?: string;
};

type RunStatus = "pass" | "needs_review" | "fail" | "error";

const STATUS_STYLES: Record<RunStatus, string> = {
  pass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  needs_review: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  fail: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  error: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

const STATUS_LABEL: Record<RunStatus, string> = {
  pass: "Pass",
  needs_review: "Needs Review",
  fail: "Fail",
  error: "Error",
};

export default function AdminAgentTestsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [difficultyFilter, setDifficultyFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const questionsQuery = useQuery<{ questions: AgentTestQuestion[] }>({
    queryKey: ["/api/admin/agent-tests/questions"],
  });
  const runsQuery = useQuery<{ runs: AgentTestRun[] }>({
    queryKey: ["/api/admin/agent-tests/runs"],
    refetchInterval: activeJobId ? 4000 : false,
  });

  // Poll active job for progress while a batch is running.
  const jobQuery = useQuery<{
    total: number;
    completed: number;
    status: "running" | "done" | "error";
    error?: string;
  }>({
    queryKey: ["/api/admin/agent-tests/job", activeJobId],
    enabled: !!activeJobId,
    refetchInterval: activeJobId ? 2000 : false,
  });

  useEffect(() => {
    if (!activeJobId || !jobQuery.data) return;
    if (jobQuery.data.status === "done" || jobQuery.data.status === "error") {
      toast({
        title: jobQuery.data.status === "done" ? "Batch complete" : "Batch failed",
        description: jobQuery.data.status === "done"
          ? `Ran ${jobQuery.data.completed} of ${jobQuery.data.total} tests.`
          : jobQuery.data.error ?? "See server logs",
        variant: jobQuery.data.status === "done" ? "default" : "destructive",
      });
      setActiveJobId(null);
      qc.invalidateQueries({ queryKey: ["/api/admin/agent-tests/runs"] });
    }
  }, [activeJobId, jobQuery.data, qc, toast]);

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/agent-tests/seed", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Seed complete", description: `Inserted ${data.inserted}, updated ${data.updated} (${data.total} total).` });
      qc.invalidateQueries({ queryKey: ["/api/admin/agent-tests/questions"] });
    },
    onError: (err: any) => toast({ title: "Seed failed", description: err.message, variant: "destructive" }),
  });

  const runSingleMutation = useMutation({
    mutationFn: async (questionId: string) => {
      const res = await apiRequest("POST", "/api/admin/agent-tests/run", { questionId });
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/agent-tests/runs"] }),
    onError: (err: any) => toast({ title: "Run failed", description: err.message, variant: "destructive" }),
  });

  const referencesQuery = useQuery<{ references: AgentReferenceAnswer[] }>({
    queryKey: ["/api/admin/agent-tests/reference-answers"],
  });

  const promoteMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await apiRequest("POST", `/api/admin/agent-tests/runs/${runId}/promote-to-reference`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Promoted to reference library", description: "The live AI agent will now use this as a few-shot example for similar questions." });
      qc.invalidateQueries({ queryKey: ["/api/admin/agent-tests/reference-answers"] });
    },
    onError: (err: any) => toast({ title: "Promote failed", description: err.message, variant: "destructive" }),
  });

  const deleteReferenceMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/agent-tests/reference-answers/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Reference removed" });
      qc.invalidateQueries({ queryKey: ["/api/admin/agent-tests/reference-answers"] });
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const applySuggestionMutation = useMutation({
    mutationFn: async (runId: string) => {
      const res = await apiRequest("POST", `/api/admin/agent-tests/runs/${runId}/apply-suggestion`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Suggestion applied",
        description: `Re-validated score: ${data?.run?.score ?? "?"} · status: ${data?.run?.status ?? "?"}`,
      });
      qc.invalidateQueries({ queryKey: ["/api/admin/agent-tests/runs"] });
    },
    onError: (err: any) => toast({ title: "Apply failed", description: err.message, variant: "destructive" }),
  });

  const runBatchMutation = useMutation({
    mutationFn: async (payload: { category?: string }) => {
      const res = await apiRequest("POST", "/api/admin/agent-tests/run-batch", payload);
      return res.json();
    },
    onSuccess: (data: any) => {
      setActiveJobId(data.jobId);
      toast({ title: "Batch started", description: "Polling for progress…" });
    },
    onError: (err: any) => toast({ title: "Batch failed to start", description: err.message, variant: "destructive" }),
  });

  const questions = questionsQuery.data?.questions ?? [];
  const runs = runsQuery.data?.runs ?? [];

  // For each question, surface the most recent run so the table can show
  // current status without rendering every historical run.
  const latestRunByQuestion = useMemo(() => {
    const map = new Map<string, AgentTestRun>();
    for (const r of runs) {
      if (!map.has(r.questionId)) map.set(r.questionId, r);
    }
    return map;
  }, [runs]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const q of questions) set.add(q.category);
    return Array.from(set).sort();
  }, [questions]);

  const filteredQuestions = useMemo(() => {
    const s = search.trim().toLowerCase();
    return questions.filter((q) => {
      if (categoryFilter !== "all" && q.category !== categoryFilter) return false;
      if (difficultyFilter !== "all" && q.difficulty !== difficultyFilter) return false;
      if (statusFilter !== "all") {
        const r = latestRunByQuestion.get(q.id);
        if (statusFilter === "untested") {
          if (r) return false;
        } else if (!r || r.status !== statusFilter) return false;
      }
      if (s && !q.question.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [questions, categoryFilter, difficultyFilter, statusFilter, search, latestRunByQuestion]);

  // Summary tiles over the most recent run for each question (a "current
  // state of the suite" view rather than a lifetime tally).
  const summary = useMemo(() => {
    let total = 0;
    let passed = 0;
    let review = 0;
    let failed = 0;
    let scoreSum = 0;
    let scored = 0;
    for (const q of questions) {
      const r = latestRunByQuestion.get(q.id);
      if (!r) continue;
      total += 1;
      if (r.status === "pass") passed += 1;
      else if (r.status === "needs_review") review += 1;
      else if (r.status === "fail" || r.status === "error") failed += 1;
      if (typeof r.score === "number") {
        scoreSum += r.score;
        scored += 1;
      }
    }
    return {
      total,
      passed,
      review,
      failed,
      avg: scored ? Math.round(scoreSum / scored) : 0,
    };
  }, [questions, latestRunByQuestion]);

  const isBusy = !!activeJobId && jobQuery.data?.status === "running";

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6" data-testid="page-admin-agent-tests">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <Beaker className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">AI Agent Test Suite</h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
              Validate the trading AI agent against a curated bank of stock, options, futures, risk, psychology and compliance prompts. Each run is graded by a strict validator model for accuracy, risk awareness and compliance safety.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            data-testid="button-seed-questions"
          >
            {seedMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
            Seed Questions
          </Button>
          <Button asChild variant="outline" size="sm" data-testid="button-export-json">
            <a href="/api/admin/agent-tests/export.json"><Download className="h-4 w-4 mr-2" />Export JSON</a>
          </Button>
          <Button asChild variant="outline" size="sm" data-testid="button-export-csv">
            <a href="/api/admin/agent-tests/export.csv"><Download className="h-4 w-4 mr-2" />Export CSV</a>
          </Button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryTile label="Tested" value={summary.total} testId="stat-tested" />
        <SummaryTile label="Passed" value={summary.passed} tone="emerald" testId="stat-passed" />
        <SummaryTile label="Needs Review" value={summary.review} tone="amber" testId="stat-review" />
        <SummaryTile label="Failed" value={summary.failed} tone="rose" testId="stat-failed" />
        <SummaryTile label="Avg Score" value={summary.avg} testId="stat-avg" />
      </div>

      {/* Filters + batch controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Run Tests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Input
              placeholder="Search questions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search"
            />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger data-testid="select-category"><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={difficultyFilter} onValueChange={setDifficultyFilter}>
              <SelectTrigger data-testid="select-difficulty"><SelectValue placeholder="All difficulties" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All difficulties</SelectItem>
                <SelectItem value="beginner">Beginner</SelectItem>
                <SelectItem value="intermediate">Intermediate</SelectItem>
                <SelectItem value="advanced">Advanced</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger data-testid="select-status"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="untested">Untested</SelectItem>
                <SelectItem value="pass">Pass</SelectItem>
                <SelectItem value="needs_review">Needs Review</SelectItem>
                <SelectItem value="fail">Fail</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Button
              size="sm"
              onClick={() => runBatchMutation.mutate({ category: categoryFilter === "all" ? undefined : categoryFilter })}
              disabled={isBusy || runBatchMutation.isPending}
              data-testid="button-run-category"
            >
              {isBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
              {categoryFilter === "all" ? "Run All Tests" : `Run "${categoryFilter}"`}
            </Button>
            {isBusy && jobQuery.data && (
              <div className="text-sm text-muted-foreground" data-testid="text-batch-progress">
                Progress: {jobQuery.data.completed} / {jobQuery.data.total}
                <span className="ml-2 inline-block w-40 h-1.5 bg-muted rounded overflow-hidden align-middle">
                  <span
                    className="block h-full bg-primary transition-all"
                    style={{ width: `${jobQuery.data.total ? Math.round((jobQuery.data.completed / jobQuery.data.total) * 100) : 0}%` }}
                  />
                </span>
              </div>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {filteredQuestions.length} of {questions.length} questions shown
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Reference library — promoted answers that the live AI agent now uses */}
      <ReferenceLibrary
        references={referencesQuery.data?.references ?? []}
        isLoading={referencesQuery.isLoading}
        onDelete={(id) => deleteReferenceMutation.mutate(id)}
        deletingId={deleteReferenceMutation.isPending ? (deleteReferenceMutation.variables as string | undefined) : undefined}
      />

      {/* Questions / runs table */}
      <Card>
        <CardContent className="p-0">
          {questionsQuery.isLoading ? (
            <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : questions.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm" data-testid="text-empty">
              No questions seeded yet. Click <strong>Seed Questions</strong> above to load the bank of 160 prompts.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead>Question</TableHead>
                  <TableHead className="w-[140px]">Category</TableHead>
                  <TableHead className="w-[100px]">Difficulty</TableHead>
                  <TableHead className="w-[80px]">Score</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="w-[150px]">Compliance</TableHead>
                  <TableHead className="w-[90px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredQuestions.map((q) => {
                  const run = latestRunByQuestion.get(q.id);
                  const v = (run?.validationJson ?? {}) as ValidationJson;
                  const isOpen = !!expanded[q.id];
                  return (
                    <Fragment key={q.id}>
                      <TableRow className="cursor-pointer" onClick={() => setExpanded((e) => ({ ...e, [q.id]: !e[q.id] }))} data-testid={`row-question-${q.id}`}>
                        <TableCell>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell className="text-sm" data-testid={`text-question-${q.id}`}>{q.question}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{q.category}</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px] capitalize">{q.difficulty}</Badge></TableCell>
                        <TableCell className="font-mono text-sm" data-testid={`text-score-${q.id}`}>
                          {run ? run.score : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          {run ? (
                            <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[run.status as RunStatus]}`} data-testid={`badge-status-${q.id}`}>
                              {STATUS_LABEL[run.status as RunStatus] ?? run.status}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">Untested</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {v.complianceIssues && v.complianceIssues.length > 0 ? (
                            <span className="text-rose-300 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{v.complianceIssues.length} issue{v.complianceIssues.length === 1 ? "" : "s"}</span>
                          ) : run ? <span className="text-emerald-300">Clean</span> : "—"}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2"
                            disabled={runSingleMutation.isPending || isBusy}
                            onClick={(e) => { e.stopPropagation(); runSingleMutation.mutate(q.id); }}
                            data-testid={`button-run-${q.id}`}
                          >
                            {runSingleMutation.isPending && runSingleMutation.variables === q.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={8} className="p-4">
                            <ExpandedDetail
                              question={q}
                              run={run}
                              validation={v}
                              onApplySuggestion={(runId) => applySuggestionMutation.mutate(runId)}
                              isApplying={applySuggestionMutation.isPending && applySuggestionMutation.variables === run?.id}
                              onPromote={(runId) => promoteMutation.mutate(runId)}
                              isPromoting={promoteMutation.isPending && promoteMutation.variables === run?.id}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReferenceLibrary({
  references,
  isLoading,
  onDelete,
  deletingId,
}: {
  references: AgentReferenceAnswer[];
  isLoading: boolean;
  onDelete: (id: string) => void;
  deletingId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="pb-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between text-left"
          data-testid="button-toggle-reference-library"
        >
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            Reference Answer Library
            <Badge variant="outline" className="ml-1 text-[10px]" data-testid="badge-reference-count">{references.length}</Badge>
          </CardTitle>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <p className="text-xs text-muted-foreground mt-1">
          Curated answers promoted from test runs. The live AI agent injects up to 3 of these as few-shot examples when a user asks a similar question — actually improving real answers, not just test scores.
        </p>
      </CardHeader>
      {open && (
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="p-4 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : references.length === 0 ? (
            <div className="text-sm text-muted-foreground p-3 text-center" data-testid="text-empty-references">
              No reference answers yet. Run a test, expand a row, and click <strong>Promote to Reference</strong> on a good answer.
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-auto">
              {references.map((r) => (
                <div key={r.id} className="border rounded p-3 bg-background" data-testid={`reference-${r.id}`}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">{r.category}</Badge>
                        {typeof r.score === "number" && r.score > 0 && (
                          <Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-300 border-emerald-500/30">Score {r.score}</Badge>
                        )}
                        <span className="text-xs font-medium truncate">{r.question}</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 shrink-0"
                      disabled={deletingId === r.id}
                      onClick={() => onDelete(r.id)}
                      data-testid={`button-delete-reference-${r.id}`}
                    >
                      {deletingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </Button>
                  </div>
                  <pre className="text-[11px] whitespace-pre-wrap text-muted-foreground max-h-32 overflow-auto">{r.referenceAnswer}</pre>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function SummaryTile({ label, value, tone, testId }: { label: string; value: number; tone?: "emerald" | "amber" | "rose"; testId?: string }) {
  const color = tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : tone === "rose" ? "text-rose-300" : "";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold mt-1 ${color}`} data-testid={testId}>{value}</div>
      </CardContent>
    </Card>
  );
}

function ExpandedDetail({
  question,
  run,
  validation,
  onApplySuggestion,
  isApplying,
  onPromote,
  isPromoting,
}: {
  question: AgentTestQuestion;
  run: AgentTestRun | undefined;
  validation: ValidationJson;
  onApplySuggestion: (runId: string) => void;
  isApplying: boolean;
  onPromote: (runId: string) => void;
  isPromoting: boolean;
}) {
  return (
    <div className="grid md:grid-cols-2 gap-4 text-sm">
      <div className="space-y-3">
        <div>
          <div className="font-semibold text-xs uppercase text-muted-foreground mb-1">Expected Answer Guidelines</div>
          <p className="text-sm leading-relaxed">{question.expectedAnswerGuidelines}</p>
        </div>
        <div>
          <div className="font-semibold text-xs uppercase text-muted-foreground mb-1">Required Concepts</div>
          <div className="flex flex-wrap gap-1">
            {(question.requiredConcepts ?? []).map((c, i) => (
              <Badge key={i} variant="outline" className="text-[10px]">{c}</Badge>
            ))}
          </div>
        </div>
        <div>
          <div className="font-semibold text-xs uppercase text-muted-foreground mb-1">Scoring Rubric</div>
          <p className="text-xs text-muted-foreground leading-relaxed">{question.scoringRubric}</p>
        </div>
      </div>
      <div className="space-y-3">
        {run ? (
          <>
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold text-xs uppercase text-muted-foreground">Full AI Answer</div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={isPromoting || !run.aiAnswer}
                  onClick={() => onPromote(run.id)}
                  data-testid={`button-promote-${run.id}`}
                  title="Save this answer as the canonical reference. The live AI agent will use it as a few-shot example for similar questions."
                >
                  {isPromoting ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Star className="h-3 w-3 mr-1.5" />}
                  Promote to Reference
                </Button>
              </div>
              <pre className="text-xs whitespace-pre-wrap bg-background p-3 rounded border max-h-64 overflow-auto" data-testid={`text-full-answer-${run.id}`}>{run.aiAnswer || "(empty)"}</pre>
            </div>
            {validation.missingConcepts && validation.missingConcepts.length > 0 && (
              <div>
                <div className="font-semibold text-xs uppercase text-muted-foreground mb-1">Missing Concepts</div>
                <ul className="list-disc list-inside text-xs text-amber-300">
                  {validation.missingConcepts.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            )}
            {validation.complianceIssues && validation.complianceIssues.length > 0 && (
              <div>
                <div className="font-semibold text-xs uppercase text-muted-foreground mb-1">Compliance Issues</div>
                <ul className="list-disc list-inside text-xs text-rose-300">
                  {validation.complianceIssues.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
            )}
            {validation.suggestedImprovedAnswer && run && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold text-xs uppercase text-muted-foreground">Suggested Better Answer</div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={isApplying}
                    onClick={() => onApplySuggestion(run.id)}
                    data-testid={`button-apply-suggestion-${run.id}`}
                  >
                    {isApplying ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1.5" />}
                    Apply &amp; Re-validate
                  </Button>
                </div>
                <p className="text-xs leading-relaxed bg-background p-3 rounded border">{validation.suggestedImprovedAnswer}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Replaces this run's recorded AI answer with the suggestion above and re-grades it.
                </p>
              </div>
            )}
            <div>
              <div className="font-semibold text-xs uppercase text-muted-foreground mb-1">Validation JSON</div>
              <pre className="text-[10px] whitespace-pre-wrap bg-background p-2 rounded border max-h-40 overflow-auto">{JSON.stringify(validation, null, 2)}</pre>
            </div>
          </>
        ) : (
          <div className="text-muted-foreground text-sm">Not yet run. Click the play button to grade this question.</div>
        )}
      </div>
    </div>
  );
}
