import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Shield,
  Search,
  ChevronLeft,
  ChevronRight,
  FileText,
} from "lucide-react";

interface DisclaimerLog {
  id: number;
  userId: string;
  userEmail: string;
  userName: string;
  acceptanceType: string;
  disclaimerVersion: string;
  disclaimerHash: string;
  accepted: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface DisclaimerLogsResponse {
  logs: DisclaimerLog[];
  total: number;
  page: number;
  pageSize: number;
}

export default function AdminDisclaimerLogs() {
  const [search, setSearch] = useState("");
  const [acceptanceType, setAcceptanceType] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const buildUrl = () => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (acceptanceType !== "all") params.set("acceptanceType", acceptanceType);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    return `/api/admin/disclaimer-logs?${params.toString()}`;
  };

  const { data, isLoading } = useQuery<DisclaimerLogsResponse>({
    queryKey: ["/api/admin/disclaimer-logs", search, acceptanceType, page],
    queryFn: async () => {
      const res = await fetch(buildUrl(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          Disclaimer Acceptance Logs
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Compliance audit trail for all user disclaimer acceptances
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5 flex-1 min-w-[200px]">
              <Label htmlFor="search">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Email, name, or user ID..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-8"
                  data-testid="input-search-disclaimer"
                />
              </div>
            </div>
            <div className="space-y-1.5 w-[200px]">
              <Label>Acceptance Type</Label>
              <Select value={acceptanceType} onValueChange={(v) => { setAcceptanceType(v); setPage(1); }}>
                <SelectTrigger data-testid="select-acceptance-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="WIZARD_AUTOPILOT_ENABLE">Wizard Autopilot</SelectItem>
                  <SelectItem value="AUTO_AGENT_ENABLE">Auto Agent Enable</SelectItem>
                  <SelectItem value="AUTO_MODE_CONSENT">Auto Mode Consent</SelectItem>
                  <SelectItem value="PARTNER_AUTO_MODE">Partner Auto Mode</SelectItem>
                  <SelectItem value="LEGAL_TERMS">Legal Terms</SelectItem>
                  <SelectItem value="TERMS_UPDATE">Terms Update</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : data?.logs && data.logs.length > 0 ? (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Accepted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.logs.map((log) => (
                      <TableRow key={log.id} data-testid={`disclaimer-row-${log.id}`}>
                        <TableCell className="text-sm whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="text-sm font-medium">{log.userName || "—"}</div>
                            <div className="text-xs text-muted-foreground">{log.userEmail}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {log.acceptanceType.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm font-mono">{log.disclaimerVersion}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {log.ipAddress || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={log.accepted ? "default" : "destructive"} className="text-xs">
                            {log.accepted ? "Yes" : "No"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between pt-4">
                <p className="text-sm text-muted-foreground">
                  {data.total} total record{data.total !== 1 ? "s" : ""}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage(p => p - 1)}
                    data-testid="button-prev-page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm">
                    Page {page} of {totalPages || 1}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage(p => p + 1)}
                    data-testid="button-next-page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-12">
              <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                {search ? "No matching disclaimer records found" : "No disclaimer acceptance records yet"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
