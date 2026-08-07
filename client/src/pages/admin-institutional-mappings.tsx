import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Link2,
  Search,
  CheckCircle2,
  XCircle,
  GitMerge,
  Play,
  RefreshCw,
  TrendingUp,
  AlertCircle,
  HelpCircle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MappingEntry {
  id: string;
  cusip: string;
  ticker: string | null;
  issuerName: string | null;
  exchange: string | null;
  assetType: string | null;
  figi: string | null;
  confidence: number;
  mappingMethod: string;
  reviewStatus: string;
  holdingCount: number;
  firstSeen: string;
  lastVerified: string;
  notes: string | null;
}

interface MappingPage {
  entries: MappingEntry[];
  total: number;
  page: number;
  pageSize: number;
}

interface MappingStats {
  reviewed: number;
  probable: number;
  needsReview: number;
  unmapped: number;
  rejected: number;
  total: number;
  mappedHoldings: number;
  unmappedHoldings: number;
  totalHoldings: number;
  coveragePercent: number;
}

interface MappingAudit {
  stats: MappingStats;
  topUnmapped: Array<{ cusip: string; issuerName: string | null; holdingCount: number; figi: string | null }>;
  remainingWork: { toReview: number; estimatedReviewMinutes: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  reviewed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  probable: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  needs_review: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  unmapped: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  rejected: "bg-red-500/10 text-red-400 border-red-500/20",
};

const STATUS_LABELS: Record<string, string> = {
  reviewed: "Reviewed",
  probable: "Probable",
  needs_review: "Needs Review",
  unmapped: "Unmapped",
  rejected: "Rejected",
};

function ConfidencePill({ value }: { value: number }) {
  const color =
    value >= 100 ? "text-emerald-400" :
    value >= 90 ? "text-blue-400" :
    value >= 80 ? "text-amber-400" :
    value >= 60 ? "text-orange-400" :
    "text-zinc-400";
  return <span className={`font-mono text-xs font-semibold ${color}`}>{value}</span>;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type Tab = "unmapped" | "needs_review" | "probable" | "reviewed" | "all";

export default function AdminInstitutionalMappingsPage() {
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<Tab>("unmapped");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);

  // Approve dialog state
  const [approving, setApproving] = useState<MappingEntry | null>(null);
  const [approveTickerInput, setApproveTickerInput] = useState("");

  // Merge dialog state
  const [merging, setMerging] = useState<MappingEntry | null>(null);
  const [mergeTargetInput, setMergeTargetInput] = useState("");

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const auditQuery = useQuery<MappingAudit>({
    queryKey: ["/api/institutional/mapping-audit"],
  });

  const queueQuery = useQuery<MappingPage>({
    queryKey: ["/api/institutional/mappings", activeTab, search, page],
    queryFn: () => {
      const params = new URLSearchParams({
        status: activeTab,
        page: String(page),
        pageSize: "25",
        orderBy: "holdingCount",
        order: "desc",
      });
      if (search) params.set("search", search);
      return apiRequest("GET", `/api/institutional/mappings?${params}`).then((r) => r.json());
    },
  });

  const pipelineMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/institutional/mapping-pipeline", { limitCusips: 5000 }).then((r) => r.json()),
    onSuccess: (data) => {
      toast({
        title: "Mapping pipeline complete",
        description: `Discovered ${data.result?.discovered ?? 0} CUSIPs, ${data.result?.unmapped ?? 0} unmapped.`,
      });
      invalidateAll();
    },
    onError: () => toast({ title: "Pipeline failed", variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: (body: object) =>
      apiRequest("POST", "/api/institutional/review", body).then((r) => r.json()),
    onSuccess: () => {
      invalidateAll();
      setApproving(null);
      setMerging(null);
      setApproveTickerInput("");
      setMergeTargetInput("");
    },
    onError: (err: any) =>
      toast({ title: "Action failed", description: err?.message ?? "Unknown error", variant: "destructive" }),
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["/api/institutional/mapping-audit"] });
    queryClient.invalidateQueries({ queryKey: ["/api/institutional/mappings"] });
  }

  function handleSearch() {
    setSearch(searchInput.toUpperCase().trim());
    setPage(1);
  }

  function handleApprove(entry: MappingEntry) {
    setApproving(entry);
    setApproveTickerInput(entry.ticker ?? "");
  }

  function submitApprove() {
    if (!approving || !approveTickerInput.match(/^[A-Z]{1,10}$/)) {
      toast({ title: "Invalid ticker", variant: "destructive" });
      return;
    }
    reviewMutation.mutate({
      action: "approve",
      cusip: approving.cusip,
      ticker: approveTickerInput,
    });
  }

  function submitReject(entry: MappingEntry) {
    reviewMutation.mutate({ action: "reject", cusip: entry.cusip });
  }

  function submitMerge() {
    if (!merging || !mergeTargetInput.match(/^[A-Z0-9]{9}$/)) {
      toast({ title: "Invalid target CUSIP", variant: "destructive" });
      return;
    }
    reviewMutation.mutate({
      action: "merge",
      fromCusip: merging.cusip,
      intoCusip: mergeTargetInput,
    });
  }

  // ---------------------------------------------------------------------------
  // Stats bar
  // ---------------------------------------------------------------------------

  const stats = auditQuery.data?.stats;

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: "unmapped", label: "Unmapped", count: stats?.unmapped },
    { key: "needs_review", label: "Needs Review", count: stats?.needsReview },
    { key: "probable", label: "Probable", count: stats?.probable },
    { key: "reviewed", label: "Reviewed", count: stats?.reviewed },
    { key: "all", label: "All" },
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Link2 className="w-6 h-6 text-blue-400" />
            CUSIP → Ticker Mapping Queue
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Review and approve institutional 13F security mappings
          </p>
        </div>
        <Button
          onClick={() => pipelineMutation.mutate()}
          disabled={pipelineMutation.isPending}
          className="gap-2"
        >
          {pipelineMutation.isPending ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          Run Mapping Pipeline
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {auditQuery.isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))
          : stats && (
              <>
                <StatCard label="Coverage" value={`${stats.coveragePercent}%`} icon={TrendingUp} color="emerald" />
                <StatCard label="Reviewed" value={stats.reviewed} icon={CheckCircle2} color="emerald" />
                <StatCard label="Probable" value={stats.probable} icon={HelpCircle} color="blue" />
                <StatCard label="Needs Review" value={stats.needsReview} icon={AlertCircle} color="amber" />
                <StatCard label="Unmapped" value={stats.unmapped} icon={XCircle} color="zinc" />
              </>
            )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-zinc-800 pb-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
              activeTab === tab.key
                ? "bg-zinc-800 text-white border-b-2 border-blue-500"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-2 text-xs text-zinc-500">({tab.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="flex gap-2">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder="Search CUSIP, ticker, or issuer name…"
          className="max-w-sm bg-zinc-900 border-zinc-700 text-white"
        />
        <Button variant="outline" onClick={handleSearch} className="gap-1 border-zinc-700">
          <Search className="w-4 h-4" />
          Search
        </Button>
        {search && (
          <Button variant="ghost" onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Queue table */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="p-0">
          {queueQuery.isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : queueQuery.data?.entries.length === 0 ? (
            <div className="p-12 text-center text-zinc-500">
              No entries found{search ? ` for "${search}"` : ""}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase">
                    <th className="text-left p-3 pl-4">CUSIP</th>
                    <th className="text-left p-3">Ticker</th>
                    <th className="text-left p-3">Issuer Name</th>
                    <th className="text-left p-3">Method</th>
                    <th className="text-center p-3">Conf</th>
                    <th className="text-center p-3">Holdings</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-right p-3 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {queueQuery.data?.entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors"
                    >
                      <td className="p-3 pl-4 font-mono text-xs text-zinc-300">{entry.cusip}</td>
                      <td className="p-3 font-mono font-semibold text-white">
                        {entry.ticker ?? <span className="text-zinc-600 italic">—</span>}
                      </td>
                      <td className="p-3 text-zinc-300 max-w-[200px] truncate" title={entry.issuerName ?? ""}>
                        {entry.issuerName ?? <span className="text-zinc-600 italic">unknown</span>}
                      </td>
                      <td className="p-3 text-zinc-500 text-xs">{entry.mappingMethod}</td>
                      <td className="p-3 text-center">
                        <ConfidencePill value={entry.confidence} />
                      </td>
                      <td className="p-3 text-center text-zinc-400">
                        {entry.holdingCount.toLocaleString()}
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs border ${
                            STATUS_COLORS[entry.reviewStatus] ?? ""
                          }`}
                        >
                          {STATUS_LABELS[entry.reviewStatus] ?? entry.reviewStatus}
                        </span>
                      </td>
                      <td className="p-3 pr-4">
                        {entry.reviewStatus !== "reviewed" && entry.reviewStatus !== "rejected" && (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                              onClick={() => handleApprove(entry)}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              onClick={() => submitReject(entry)}
                              disabled={reviewMutation.isPending}
                            >
                              <XCircle className="w-3.5 h-3.5 mr-1" />
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                              onClick={() => { setMerging(entry); setMergeTargetInput(""); }}
                            >
                              <GitMerge className="w-3.5 h-3.5 mr-1" />
                              Merge
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {queueQuery.data && queueQuery.data.total > queueQuery.data.pageSize && (
            <div className="flex items-center justify-between p-4 border-t border-zinc-800">
              <span className="text-xs text-zinc-500">
                {queueQuery.data.total.toLocaleString()} entries
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-zinc-700"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <span className="text-xs text-zinc-400 self-center">
                  Page {page} of {Math.ceil(queueQuery.data.total / queueQuery.data.pageSize)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-zinc-700"
                  disabled={page >= Math.ceil(queueQuery.data.total / queueQuery.data.pageSize)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top unmapped issuers */}
      {auditQuery.data?.topUnmapped && auditQuery.data.topUnmapped.length > 0 && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-white">Top Unmapped Issuers</CardTitle>
            <CardDescription className="text-zinc-500">
              Highest-impact CUSIPs without a confirmed ticker assignment
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {auditQuery.data.topUnmapped.map((item) => (
                <div
                  key={item.cusip}
                  className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0"
                >
                  <div>
                    <span className="font-mono text-xs text-zinc-400 mr-3">{item.cusip}</span>
                    <span className="text-sm text-zinc-300">{item.issuerName ?? "Unknown issuer"}</span>
                    {item.figi && (
                      <span className="ml-2 text-xs text-zinc-600">FIGI: {item.figi}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500">
                      {item.holdingCount.toLocaleString()} holdings
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-emerald-400 hover:bg-emerald-500/10"
                      onClick={() => {
                        // Find entry in queue or create placeholder
                        const placeholder: MappingEntry = {
                          id: item.cusip,
                          cusip: item.cusip,
                          ticker: null,
                          issuerName: item.issuerName,
                          exchange: null,
                          assetType: null,
                          figi: item.figi,
                          confidence: 0,
                          mappingMethod: "unmapped",
                          reviewStatus: "unmapped",
                          holdingCount: item.holdingCount,
                          firstSeen: "",
                          lastVerified: "",
                          notes: null,
                        };
                        handleApprove(placeholder);
                      }}
                    >
                      Approve
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Approve dialog */}
      {approving && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <Card className="bg-zinc-900 border-zinc-700 w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-white">Approve Mapping</CardTitle>
              <CardDescription className="text-zinc-400">
                CUSIP: <span className="font-mono text-zinc-200">{approving.cusip}</span>
                {approving.issuerName && (
                  <span> — {approving.issuerName}</span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Ticker symbol</label>
                <Input
                  value={approveTickerInput}
                  onChange={(e) => setApproveTickerInput(e.target.value.toUpperCase().trim())}
                  placeholder="e.g. AAPL"
                  className="bg-zinc-800 border-zinc-600 text-white font-mono"
                  onKeyDown={(e) => e.key === "Enter" && submitApprove()}
                  autoFocus
                />
                {approveTickerInput && !approveTickerInput.match(/^[A-Z]{1,10}$/) && (
                  <p className="text-xs text-red-400 mt-1">1–10 uppercase letters only</p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => { setApproving(null); setApproveTickerInput(""); }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={submitApprove}
                  disabled={reviewMutation.isPending || !approveTickerInput.match(/^[A-Z]{1,10}$/)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  {reviewMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                  )}
                  Approve
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Merge dialog */}
      {merging && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <Card className="bg-zinc-900 border-zinc-700 w-full max-w-md">
            <CardHeader>
              <CardTitle className="text-white">Merge into Reviewed CUSIP</CardTitle>
              <CardDescription className="text-zinc-400">
                <span className="font-mono">{merging.cusip}</span> will inherit the ticker from the target reviewed CUSIP.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  Target CUSIP (must be reviewed)
                </label>
                <Input
                  value={mergeTargetInput}
                  onChange={(e) => setMergeTargetInput(e.target.value.toUpperCase().trim())}
                  placeholder="e.g. 22160K105"
                  className="bg-zinc-800 border-zinc-600 text-white font-mono"
                  onKeyDown={(e) => e.key === "Enter" && submitMerge()}
                  autoFocus
                />
                {mergeTargetInput && !mergeTargetInput.match(/^[A-Z0-9]{9}$/) && (
                  <p className="text-xs text-red-400 mt-1">Must be exactly 9 uppercase alphanumeric characters</p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => { setMerging(null); setMergeTargetInput(""); }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={submitMerge}
                  disabled={reviewMutation.isPending || !mergeTargetInput.match(/^[A-Z0-9]{9}$/)}
                  className="bg-blue-600 hover:bg-blue-500 text-white"
                >
                  {reviewMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <GitMerge className="w-4 h-4 mr-1" />
                  )}
                  Merge
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card component
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: "emerald" | "blue" | "amber" | "zinc";
}) {
  const colorMap = {
    emerald: "text-emerald-400 bg-emerald-500/10",
    blue: "text-blue-400 bg-blue-500/10",
    amber: "text-amber-400 bg-amber-500/10",
    zinc: "text-zinc-400 bg-zinc-500/10",
  };
  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colorMap[color]}`}>
          <Icon className={`w-4 h-4 ${colorMap[color].split(" ")[0]}`} />
        </div>
        <div>
          <p className="text-xs text-zinc-500">{label}</p>
          <p className="text-lg font-bold text-white">
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
