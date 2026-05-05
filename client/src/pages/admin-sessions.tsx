import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Eye,
  LogIn,
  LogOut,
  UserPlus,
  Search,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Smartphone,
  Monitor,
} from "lucide-react";
import { queryClient } from "@/lib/queryClient";

interface SessionEvent {
  id: string;
  userId: string | null;
  email: string | null;
  eventType: string;
  ipAddress: string | null;
  userAgent: string | null;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
  createdAt: string;
}

interface SessionsResponse {
  events: SessionEvent[];
  total: number;
  page: number;
  pageSize: number;
}

export default function AdminSessionsPage() {
  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (eventType !== "all") params.set("eventType", eventType);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  const url = `/api/admin/sessions?${params.toString()}`;

  const { data, isLoading } = useQuery<SessionsResponse>({
    queryKey: ["/api/admin/sessions", search, eventType, page],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 0;

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-sessions-title">
            <Eye className="h-6 w-6 text-primary" />
            User Session Audit Log
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track user login and logout events with IP, browser, and device info.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/sessions"] })}
          data-testid="button-refresh-sessions"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="text-xs text-muted-foreground">Search</label>
              <div className="relative mt-1">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by email, IP, browser..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9"
                  data-testid="input-search-sessions"
                />
              </div>
            </div>
            <div className="w-[180px]">
              <label className="text-xs text-muted-foreground">Event Type</label>
              <Select
                value={eventType}
                onValueChange={(v) => {
                  setEventType(v);
                  setPage(1);
                }}
              >
                <SelectTrigger data-testid="select-event-type" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Events</SelectItem>
                  <SelectItem value="login">Login</SelectItem>
                  <SelectItem value="logout">Logout</SelectItem>
                  <SelectItem value="register">Register</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Browser / OS</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={6}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </>
                )}
                {!isLoading && data?.events.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No session events match your filters.
                    </TableCell>
                  </TableRow>
                )}
                {data?.events.map((evt) => (
                  <TableRow key={evt.id} data-testid={`row-session-${evt.id}`}>
                    <TableCell>
                      <EventBadge type={evt.eventType} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <div className="text-muted-foreground">{(evt.userId || "").slice(0, 8) || "-"}...</div>
                      <div className="font-sans text-foreground">{evt.email || "(unknown)"}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{evt.ipAddress || "-"}</TableCell>
                    <TableCell>
                      <DeviceCell type={evt.deviceType} />
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{evt.browser || "-"}</div>
                      <div className="text-muted-foreground">{evt.os || ""}</div>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {evt.createdAt ? new Date(evt.createdAt).toLocaleString() : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {data && data.total > 0 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-xs text-muted-foreground" data-testid="text-sessions-pagination">
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data.total)} of {data.total}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  data-testid="button-next-page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EventBadge({ type }: { type: string }) {
  if (type === "login") {
    return (
      <Badge variant="default" className="gap-1">
        <LogIn className="h-3 w-3" />
        login
      </Badge>
    );
  }
  if (type === "logout") {
    return (
      <Badge variant="secondary" className="gap-1">
        <LogOut className="h-3 w-3" />
        logout
      </Badge>
    );
  }
  if (type === "register") {
    return (
      <Badge variant="outline" className="gap-1">
        <UserPlus className="h-3 w-3" />
        register
      </Badge>
    );
  }
  return <Badge variant="outline">{type}</Badge>;
}

function DeviceCell({ type }: { type: string | null }) {
  const isMobile = type === "mobile" || type === "tablet";
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      {isMobile ? <Smartphone className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
      <span className="capitalize">{type || "Desktop"}</span>
    </span>
  );
}
