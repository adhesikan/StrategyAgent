import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Users,
  Search,
  ChevronLeft,
  ChevronRight,
  Shield,
  ShieldAlert,
  UserPlus,
  Link2,
  Bot,
  TrendingUp,
  FileText,
  Loader2,
  Eye,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface AdminUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  subscriptionStatus: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface UserListResponse {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}

interface AdminStats {
  totalUsers: number;
  newUsersThisWeek: number;
  newUsersThisMonth: number;
  activeBrokerConnections: number;
  autoAgentUsers: number;
  adminUsers: number;
  totalComplianceRecords: number;
}

interface UserDetail {
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    subscriptionStatus: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  };
  broker: {
    provider: string;
    isConnected: boolean;
    preferredAccountId: string | null;
  } | null;
  agentSettings: {
    mode: string;
    riskPerTradeUsd: number | null;
    maxDailyLossUsd: number | null;
    maxTradesPerDay: number | null;
  } | null;
  tradeCount: number;
  consentCount: number;
}

function formatDate(date: string | Date | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function StatCard({ title, value, icon: Icon, description }: { title: string; value: number | string; icon: any; description?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold" data-testid={`stat-${title.toLowerCase().replace(/\s+/g, "-")}`}>{value}</p>
            {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
          </div>
          <Icon className="h-8 w-8 text-muted-foreground/30" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminUsersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const buildUrl = () => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (roleFilter !== "all") params.set("role", roleFilter);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    return `/api/admin/users?${params.toString()}`;
  };

  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    enabled: user?.role === "admin",
  });

  const { data, isLoading } = useQuery<UserListResponse>({
    queryKey: ["/api/admin/users", search, roleFilter, page],
    queryFn: async () => {
      const res = await fetch(buildUrl(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch users");
      return res.json();
    },
    enabled: user?.role === "admin",
  });

  const { data: userDetail, isLoading: detailLoading } = useQuery<UserDetail>({
    queryKey: ["/api/admin/users", selectedUserId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${selectedUserId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch user details");
      return res.json();
    },
    enabled: !!selectedUserId && user?.role === "admin",
  });

  const roleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${userId}`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "User role updated" });
    },
    onError: () => {
      toast({ title: "Failed to update user role", variant: "destructive" });
    },
  });

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  if (user?.role !== "admin") {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <ShieldAlert className="h-12 w-12 mx-auto text-destructive mb-4" />
            <h2 className="text-lg font-bold">Admin Access Required</h2>
            <p className="text-sm text-muted-foreground mt-2">You need administrator privileges to access this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-admin-users-title">
          <Users className="h-6 w-6 text-primary" />
          User Administration
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage users, view activity, and monitor platform usage
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : stats ? (
          <>
            <StatCard title="Total Users" value={stats.totalUsers} icon={Users} description={`${stats.newUsersThisWeek} new this week`} />
            <StatCard title="New This Month" value={stats.newUsersThisMonth} icon={UserPlus} />
            <StatCard title="Broker Connected" value={stats.activeBrokerConnections} icon={Link2} />
            <StatCard title="Auto Agent Active" value={stats.autoAgentUsers} icon={Bot} />
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {stats && (
          <>
            <StatCard title="Admin Users" value={stats.adminUsers} icon={Shield} />
            <StatCard title="Compliance Records" value={stats.totalComplianceRecords} icon={FileText} />
          </>
        )}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All Users</CardTitle>
          <CardDescription>Search, filter, and manage user accounts</CardDescription>
          <div className="flex flex-wrap items-end gap-4 pt-2">
            <div className="space-y-1.5 flex-1 min-w-[200px]">
              <Label htmlFor="search-users">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search-users"
                  placeholder="Email, name, or user ID..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-8"
                  data-testid="input-search-users"
                />
              </div>
            </div>
            <div className="space-y-1.5 w-[160px]">
              <Label>Role</Label>
              <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(1); }}>
                <SelectTrigger data-testid="select-role-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : data?.users && data.users.length > 0 ? (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Subscription</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.users.map((u) => (
                      <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                        <TableCell>
                          <div>
                            <div className="text-sm font-medium">
                              {u.firstName || u.lastName ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "—"}
                            </div>
                            <div className="text-xs text-muted-foreground">{u.email}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={u.role === "admin" ? "default" : "outline"} className={u.role === "admin" ? "bg-purple-600" : ""}>
                            {u.role === "admin" ? "Admin" : "User"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {u.subscriptionStatus ? (
                            <Badge variant="outline" className="text-xs">{u.subscriptionStatus}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{formatDate(u.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center gap-2 justify-end">
                            <Select
                              value={u.role}
                              onValueChange={(newRole) => {
                                if (newRole !== u.role) {
                                  roleMutation.mutate({ userId: u.id, role: newRole });
                                }
                              }}
                            >
                              <SelectTrigger className="w-[100px] h-8 text-xs" data-testid={`select-role-${u.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="user">User</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1"
                              onClick={() => setSelectedUserId(u.id)}
                              data-testid={`button-view-user-${u.id}`}
                            >
                              <Eye className="h-3 w-3" />
                              View
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between pt-4">
                <p className="text-sm text-muted-foreground" data-testid="text-total-users">
                  {data.total} total user{data.total !== 1 ? "s" : ""}
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
              <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                {search ? "No matching users found" : "No users yet"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedUserId} onOpenChange={(open) => { if (!open) setSelectedUserId(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              User Details
            </DialogTitle>
            <DialogDescription>
              Detailed view of user account and activity
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : userDetail ? (
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium" data-testid="text-detail-name">
                        {userDetail.user.firstName || userDetail.user.lastName
                          ? `${userDetail.user.firstName || ""} ${userDetail.user.lastName || ""}`.trim()
                          : "No name set"}
                      </p>
                      <p className="text-sm text-muted-foreground" data-testid="text-detail-email">{userDetail.user.email}</p>
                    </div>
                    <Badge variant={userDetail.user.role === "admin" ? "default" : "outline"} className={userDetail.user.role === "admin" ? "bg-purple-600" : ""}>
                      {userDetail.user.role === "admin" ? "Admin" : "User"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Created:</span>{" "}
                      <span data-testid="text-detail-created">{formatDate(userDetail.user.createdAt)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Updated:</span>{" "}
                      <span>{formatDate(userDetail.user.updatedAt)}</span>
                    </div>
                    {userDetail.user.subscriptionStatus && (
                      <div>
                        <span className="text-muted-foreground">Subscription:</span>{" "}
                        <Badge variant="outline" className="text-xs ml-1">{userDetail.user.subscriptionStatus}</Badge>
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono break-all">
                    ID: {userDetail.user.id}
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-2 gap-3">
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Link2 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Broker</span>
                    </div>
                    {userDetail.broker ? (
                      <div className="text-sm">
                        <Badge variant={userDetail.broker.isConnected ? "default" : "outline"} className={userDetail.broker.isConnected ? "bg-green-600" : ""}>
                          {userDetail.broker.provider}
                        </Badge>
                        <p className="text-xs text-muted-foreground mt-1">
                          {userDetail.broker.isConnected ? "Connected" : "Disconnected"}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not connected</p>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Bot className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Agent</span>
                    </div>
                    {userDetail.agentSettings ? (
                      <div className="text-sm space-y-1">
                        <Badge variant={userDetail.agentSettings.mode === "auto" ? "default" : "outline"}>
                          {userDetail.agentSettings.mode === "auto" ? "Auto" : "Suggest"}
                        </Badge>
                        {userDetail.agentSettings.riskPerTradeUsd && (
                          <p className="text-xs text-muted-foreground">
                            Risk: ${userDetail.agentSettings.riskPerTradeUsd}/trade
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not configured</p>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-1">
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Trades</span>
                    </div>
                    <p className="text-lg font-bold" data-testid="text-detail-trades">{userDetail.tradeCount}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-1">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Compliance</span>
                    </div>
                    <p className="text-lg font-bold" data-testid="text-detail-compliance">{userDetail.consentCount}</p>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
