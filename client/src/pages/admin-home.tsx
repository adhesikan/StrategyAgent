import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { Users, Mail, Eye, Handshake, Shield, ArrowRight, ShieldAlert } from "lucide-react";

interface AdminStats {
  totalUsers: number;
  newUsersThisWeek: number;
  newUsersThisMonth: number;
  activeBrokerConnections: number;
  autoAgentUsers: number;
  adminUsers: number;
  totalComplianceRecords: number;
}

const tools = [
  {
    title: "User Management",
    description: "View accounts, change roles, inspect activity",
    href: "/admin/users",
    icon: Users,
    testId: "card-admin-users",
  },
  {
    title: "Email Campaigns",
    description: "Send newsletters & track delivery / opens",
    href: "/admin/emails",
    icon: Mail,
    testId: "card-admin-emails",
  },
  {
    title: "Sessions Audit Log",
    description: "Login/logout events with IP, browser & device",
    href: "/admin/sessions",
    icon: Eye,
    testId: "card-admin-sessions",
  },
  {
    title: "Partners",
    description: "Signal providers & API keys",
    href: "/admin/partners",
    icon: Handshake,
    testId: "card-admin-partners",
  },
  {
    title: "Compliance Logs",
    description: "Disclaimer acceptance audit trail",
    href: "/admin/disclaimer-logs",
    icon: Shield,
    testId: "card-admin-compliance",
  },
];

export default function AdminHomePage() {
  const { data: stats } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
  });

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <ShieldAlert className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-admin-home-title">Admin Panel</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage users, send campaigns, and audit account activity.
          </p>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="Total Users" value={stats.totalUsers} testId="stat-total-users" />
          <StatTile label="New (7d)" value={stats.newUsersThisWeek} testId="stat-new-7d" />
          <StatTile label="New (30d)" value={stats.newUsersThisMonth} testId="stat-new-30d" />
          <StatTile label="Admins" value={stats.adminUsers} testId="stat-admins" />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((tool) => (
          <Link key={tool.href} href={tool.href} data-testid={tool.testId}>
            <Card className="hover-elevate cursor-pointer h-full">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="h-9 w-9 rounded-md bg-accent/50 flex items-center justify-center">
                    <tool.icon className="h-4 w-4" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
                <CardTitle className="text-base mt-3">{tool.title}</CardTitle>
                <CardDescription>{tool.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatTile({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1" data-testid={testId}>
          {value.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}
