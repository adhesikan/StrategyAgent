import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail, Send, RefreshCw, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface EmailCampaign {
  id: string;
  subject: string;
  audienceType: string;
  recipientUserId: string | null;
  status: string;
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  clickedCount: number;
  bouncedCount: number;
  errorMessage: string | null;
  createdAt: string;
  sentAt: string | null;
}

interface CampaignsResponse {
  campaigns: EmailCampaign[];
  total: number;
  page: number;
  pageSize: number;
}

interface ProviderStatus {
  configured: boolean;
  provider: string | null;
  fromAddress: string | null;
  reason: string | null;
}

export default function AdminEmailsPage() {
  const { toast } = useToast();
  const [audience, setAudience] = useState("all");
  const [recipientUserId, setRecipientUserId] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");

  const { data: provider } = useQuery<ProviderStatus>({
    queryKey: ["/api/admin/email-campaigns/provider"],
  });

  const { data: history, isLoading: historyLoading } = useQuery<CampaignsResponse>({
    queryKey: ["/api/admin/email-campaigns"],
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const body: any = { subject, html, audienceType: audience };
      if (audience === "individual") body.recipientUserId = recipientUserId.trim();
      return apiRequest("POST", "/api/admin/email-campaigns", body);
    },
    onSuccess: async () => {
      toast({ title: "Campaign queued", description: "Sent successfully — check history for status." });
      setSubject("");
      setHtml("");
      setRecipientUserId("");
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/email-campaigns"] });
    },
    onError: (err: any) => {
      toast({
        title: "Send failed",
        description: err?.message || "Unable to send campaign.",
        variant: "destructive",
      });
    },
  });

  const canSend =
    subject.trim().length > 0 &&
    html.trim().length > 0 &&
    (audience !== "individual" || recipientUserId.trim().length > 0) &&
    provider?.configured;

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-emails-title">
          <Mail className="h-6 w-6 text-primary" />
          Email Campaign Console
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Send emails to individual users, selected segments, or all active users.
        </p>
      </div>

      {provider && !provider.configured && (
        <Alert variant="destructive" data-testid="alert-provider-missing">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Email provider not configured</AlertTitle>
          <AlertDescription>
            {provider.reason ||
              "No email provider is set up. Add SENDGRID_API_KEY (and EMAIL_FROM_ADDRESS) in Secrets to enable sending."}
          </AlertDescription>
        </Alert>
      )}

      {provider && provider.configured && (
        <Alert data-testid="alert-provider-ready">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Provider: {provider.provider}</AlertTitle>
          <AlertDescription>
            Sending from <code className="text-xs">{provider.fromAddress || "(no from address set)"}</code>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Send Email Campaign
          </CardTitle>
          <CardDescription>HTML supported. Unsubscribe links and footer should be added by your provider templates.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="audience">Audience</Label>
            <Select value={audience} onValueChange={setAudience}>
              <SelectTrigger id="audience" data-testid="select-audience" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Active Users (email opted-in)</SelectItem>
                <SelectItem value="admins">Admin Users Only</SelectItem>
                <SelectItem value="individual">Individual User (by user ID)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {audience === "individual" && (
            <div>
              <Label htmlFor="recipient">Recipient User ID</Label>
              <Input
                id="recipient"
                placeholder="user uuid..."
                value={recipientUserId}
                onChange={(e) => setRecipientUserId(e.target.value)}
                className="mt-1 font-mono text-xs"
                data-testid="input-recipient"
              />
            </div>
          )}

          <div>
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              placeholder="Email subject line"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="mt-1"
              data-testid="input-subject"
            />
          </div>

          <div>
            <Label htmlFor="message">Message (HTML supported)</Label>
            <Textarea
              id="message"
              placeholder="Enter your email message. HTML formatting is supported."
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              className="mt-1 min-h-[200px] font-mono text-xs"
              data-testid="textarea-html"
            />
          </div>

          <div className="flex items-center justify-between">
            <Button
              onClick={() => sendMutation.mutate()}
              disabled={!canSend || sendMutation.isPending}
              data-testid="button-send-campaign"
            >
              {sendMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Email Campaign
                </>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              {audience === "all" && "Will send to all active, email-opted-in users"}
              {audience === "admins" && "Will send to admin users only"}
              {audience === "individual" && "Will send to one user"}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Campaign History</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/email-campaigns"] })}
            data-testid="button-refresh-campaigns"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sent At</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Opens</TableHead>
                  <TableHead className="text-right">Clicks</TableHead>
                  <TableHead className="text-right">Bounces</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyLoading && (
                  <>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={8}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </>
                )}
                {!historyLoading && (history?.campaigns.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No campaigns sent yet.
                    </TableCell>
                  </TableRow>
                )}
                {history?.campaigns.map((c) => (
                  <TableRow key={c.id} data-testid={`row-campaign-${c.id}`}>
                    <TableCell className="text-xs">
                      {c.sentAt ? new Date(c.sentAt).toLocaleString() : new Date(c.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate" title={c.subject}>
                      {c.subject}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{c.audienceType}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.sentCount ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.openedCount ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.clickedCount ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.bouncedCount ?? 0}</TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} error={c.errorMessage} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status, error }: { status: string; error: string | null }) {
  if (status === "sent" || status === "completed") {
    return <Badge variant="default" className="capitalize">{status}</Badge>;
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="capitalize" title={error || ""}>
        failed
      </Badge>
    );
  }
  return <Badge variant="secondary" className="capitalize">{status}</Badge>;
}
