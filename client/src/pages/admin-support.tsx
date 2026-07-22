import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, RefreshCw, Send, ShieldOff, ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import type { SupportTicket, SupportMessage, EmailSuppression, EmailMessage, EmailSettings } from "@shared/schema";

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  waiting_on_customer: "Waiting on Customer",
  resolved: "Resolved",
  closed: "Closed",
};

function statusBadge(status: string) {
  const variant = status === "open" ? "default" : status === "waiting_on_customer" ? "secondary" : "outline";
  return <Badge variant={variant} className="text-[10px]">{STATUS_LABELS[status] || status}</Badge>;
}

function fmt(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

interface TicketListResponse {
  tickets: SupportTicket[];
  total: number;
  page: number;
  pageSize: number;
}

interface TicketDetailResponse {
  ticket: SupportTicket;
  messages: SupportMessage[];
  linkedUser: { id: string; email: string; planId: string | null; subscriptionStatus: string | null } | null;
  deliveries: Pick<EmailMessage, "id" | "messageType" | "status" | "subject" | "sentAt" | "createdAt">[];
}

interface HealthResponse {
  resendConfigured: boolean;
  webhookConfigured: boolean;
  domainExpected: string;
  defaultSender: string;
  lastWebhookAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  pendingJobs: number;
  failedJobs: number;
  recentFailures: { id: string; subject: string; status: string; createdAt: string }[];
}

function HealthPanel() {
  const { data, isLoading } = useQuery<HealthResponse>({ queryKey: ["/api/admin/support/health"] });
  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Loading email service status…</p>;
  const Item = ({ ok, label, value }: { ok?: boolean; label: string; value: string }) => (
    <div className="flex items-center gap-2 text-sm">
      {ok === undefined ? <Mail className="h-4 w-4 text-muted-foreground" /> : ok ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-destructive" />}
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium" data-testid={`text-health-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</span>
    </div>
  );
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Item ok={data.resendConfigured} label="Resend configured" value={data.resendConfigured ? "Yes" : "No"} />
      <Item ok={data.webhookConfigured} label="Webhook configured" value={data.webhookConfigured ? "Yes" : "No"} />
      <Item label="Domain" value={data.domainExpected} />
      <Item label="Default sender" value={data.defaultSender} />
      <Item label="Last webhook" value={fmt(data.lastWebhookAt)} />
      <Item label="Last inbound" value={fmt(data.lastInboundAt)} />
      <Item label="Last outbound" value={fmt(data.lastOutboundAt)} />
      <Item ok={data.failedJobs === 0} label="Jobs" value={`${data.pendingJobs} pending / ${data.failedJobs} failed`} />
    </div>
  );
}

function TicketDetail({ ticketId, onBack }: { ticketId: string; onBack: () => void }) {
  const { toast } = useToast();
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const { data, isLoading } = useQuery<TicketDetailResponse>({ queryKey: ["/api/admin/support/tickets", ticketId] });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/support/tickets", ticketId] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/support/tickets"] });
  };

  const replyMut = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/support/tickets/${ticketId}/reply`, { body: reply }),
    onSuccess: () => { setReply(""); invalidate(); toast({ title: "Reply sent" }); },
    onError: (e: Error) => toast({ title: "Reply failed", description: e.message, variant: "destructive" }),
  });
  const patchMut = useMutation({
    mutationFn: async (patch: Record<string, string>) => apiRequest("PATCH", `/api/admin/support/tickets/${ticketId}`, patch),
    onSuccess: () => { setNote(""); invalidate(); },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) return <Loader2 className="h-5 w-5 animate-spin" />;
  const { ticket, messages, linkedUser, deliveries } = data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-to-tickets"><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <span className="font-mono text-sm font-semibold" data-testid="text-ticket-number">{ticket.ticketNumber}</span>
        {statusBadge(ticket.status)}
        <Badge variant="outline" className="text-[10px]">{ticket.priority}</Badge>
        <Badge variant="outline" className="text-[10px]">{ticket.category}</Badge>
      </div>
      <Card>
        <CardContent className="p-4 space-y-1 text-sm">
          <p className="font-medium" data-testid="text-ticket-subject">{ticket.subject}</p>
          <p className="text-muted-foreground">From: {ticket.requesterName ? `${ticket.requesterName} <${ticket.requesterEmail}>` : ticket.requesterEmail}</p>
          <p className="text-muted-foreground">
            Linked account: {linkedUser ? `${linkedUser.email} (${linkedUser.planId || "free"} / ${linkedUser.subscriptionStatus || "—"})` : "No matching user"}
          </p>
          {ticket.aiSummary && <p className="text-xs bg-muted rounded p-2 mt-2">AI summary: {ticket.aiSummary}</p>}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {messages.map((m) => (
          <Card key={m.id} className={m.direction === "OUTBOUND" ? "border-primary/40" : ""} data-testid={`card-support-message-${m.id}`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                <span>{m.senderType === "admin" ? "VCP Trader AI (admin)" : m.senderEmail}</span>
                <span>{fmt(m.createdAt)}</span>
              </div>
              {m.sanitizedBodyHtml ? (
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: m.sanitizedBodyHtml }} />
              ) : (
                <pre className="whitespace-pre-wrap text-sm font-sans">{m.bodyText || "(no body)"}</pre>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Reply to customer</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {ticket.aiSuggestedReply && (
            <Button variant="outline" size="sm" onClick={() => setReply(ticket.aiSuggestedReply || "")} data-testid="button-use-ai-reply">
              Use AI suggested reply
            </Button>
          )}
          <Textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={5} placeholder="Write a reply — it will be emailed from team@vcptrader.com" data-testid="input-ticket-reply" />
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => replyMut.mutate()} disabled={!reply.trim() || replyMut.isPending} data-testid="button-send-reply">
              {replyMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}Send reply
            </Button>
            {ticket.status !== "resolved" ? (
              <Button variant="outline" onClick={() => patchMut.mutate({ status: "resolved" })} data-testid="button-resolve-ticket">Resolve</Button>
            ) : (
              <Button variant="outline" onClick={() => patchMut.mutate({ status: "open" })} data-testid="button-reopen-ticket">Reopen</Button>
            )}
            <Select value={ticket.priority} onValueChange={(v) => patchMut.mutate({ priority: v })}>
              <SelectTrigger className="w-32" data-testid="select-ticket-priority"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Internal notes</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(ticket.internalNotes || []).map((n, i) => (
            <p key={i} className="text-xs bg-muted rounded p-2">{n.note} <span className="text-muted-foreground">— {fmt(n.at)}</span></p>
          ))}
          <div className="flex gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add internal note" data-testid="input-internal-note" />
            <Button variant="outline" onClick={() => patchMut.mutate({ note })} disabled={!note.trim()} data-testid="button-add-note">Add</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Email delivery history</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {deliveries.length === 0 && <p className="text-xs text-muted-foreground">No outbound emails for this ticket.</p>}
          {deliveries.map((d) => (
            <div key={d.id} className="flex items-center justify-between text-xs">
              <span className="truncate mr-2">{d.messageType} — {d.subject}</span>
              <Badge variant={d.status === "FAILED" || d.status === "BOUNCED" ? "destructive" : "outline"} className="text-[10px]">{d.status}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsPanel() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<EmailSettings>({ queryKey: ["/api/admin/support/settings"] });
  const save = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => apiRequest("PUT", "/api/admin/support/settings", patch),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/admin/support/settings"] }); toast({ title: "Settings saved" }); },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });
  if (isLoading || !data) return <Loader2 className="h-5 w-5 animate-spin" />;
  const Toggle = ({ field, label }: { field: keyof EmailSettings; label: string }) => (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <Switch checked={Boolean(data[field])} onCheckedChange={(v) => save.mutate({ [field]: v })} data-testid={`switch-${String(field)}`} />
    </div>
  );
  return (
    <div className="space-y-4 max-w-xl">
      <div className="grid gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Default sender name</label>
          <Input defaultValue={data.defaultSenderName} onBlur={(e) => e.target.value !== data.defaultSenderName && save.mutate({ defaultSenderName: e.target.value })} data-testid="input-sender-name" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Default reply-to</label>
          <Input defaultValue={data.defaultReplyTo} onBlur={(e) => e.target.value !== data.defaultReplyTo && save.mutate({ defaultReplyTo: e.target.value })} data-testid="input-reply-to" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Forwarding destination</label>
          <Input defaultValue={data.forwardingDestination} onBlur={(e) => e.target.value !== data.forwardingDestination && save.mutate({ forwardingDestination: e.target.value })} data-testid="input-forward-dest" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Expected-response wording (optional, shown in acknowledgment)</label>
          <Input defaultValue={data.expectedResponseWording || ""} onBlur={(e) => save.mutate({ expectedResponseWording: e.target.value || null })} data-testid="input-response-wording" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Max attachment size (MB)</label>
          <Input type="number" defaultValue={data.maxAttachmentSizeMb} onBlur={(e) => save.mutate({ maxAttachmentSizeMb: parseInt(e.target.value, 10) || 10 })} data-testid="input-max-attachment" />
        </div>
      </div>
      <div className="space-y-2 pt-2 border-t">
        <Toggle field="inboundAckEnabled" label="Send inbound acknowledgment" />
        <Toggle field="supportForwardingEnabled" label="Forward inbound to support inbox" />
        <Toggle field="openTrackingEnabled" label="Email open tracking" />
        <Toggle field="clickTrackingEnabled" label="Email click tracking" />
        <Toggle field="aiClassificationEnabled" label="AI support classification" />
        <Toggle field="aiReplySuggestionsEnabled" label="AI reply suggestions" />
      </div>
      <p className="text-xs text-muted-foreground">API keys and webhook secrets are managed in environment variables and are never shown here.</p>
    </div>
  );
}

export default function AdminSupportPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedTicket, setSelectedTicket] = useState<string | null>(() => new URLSearchParams(window.location.search).get("ticket"));
  const [suppressInput, setSuppressInput] = useState("");

  const { data: list, isLoading } = useQuery<TicketListResponse>({
    queryKey: ["/api/admin/support/tickets", { status, q: search, page }],
    queryFn: async () => {
      const params = new URLSearchParams({ status, q: search, page: String(page) });
      const res = await fetch(`/api/admin/support/tickets?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load tickets");
      return res.json();
    },
  });
  const { data: suppressions } = useQuery<EmailSuppression[]>({ queryKey: ["/api/admin/support/suppressions"] });
  const { data: failures } = useQuery<EmailMessage[]>({ queryKey: ["/api/admin/support/failed-deliveries"] });

  const addSuppress = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/support/suppressions", { emailAddress: suppressInput }),
    onSuccess: () => { setSuppressInput(""); queryClient.invalidateQueries({ queryKey: ["/api/admin/support/suppressions"] }); },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const removeSuppress = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/support/suppressions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/support/suppressions"] }),
  });

  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-support-center-title">Support Center</h1>
        <p className="text-sm text-muted-foreground">Inbound email to team@vcptrader.com, support tickets, and email delivery health.</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Email service status</CardTitle></CardHeader>
        <CardContent><HealthPanel /></CardContent>
      </Card>

      {selectedTicket ? (
        <TicketDetail ticketId={selectedTicket} onBack={() => setSelectedTicket(null)} />
      ) : (
        <Tabs defaultValue="tickets">
          <TabsList>
            <TabsTrigger value="tickets" data-testid="tab-tickets">Tickets</TabsTrigger>
            <TabsTrigger value="failures" data-testid="tab-failures">Failed Deliveries</TabsTrigger>
            <TabsTrigger value="suppressions" data-testid="tab-suppressions">Suppressions</TabsTrigger>
            <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="tickets" className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
                <SelectTrigger className="w-48" data-testid="select-status-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input className="max-w-xs" placeholder="Search subject, email, ticket #" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} data-testid="input-ticket-search" />
              <Button variant="ghost" size="icon" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/admin/support/tickets"] })} data-testid="button-refresh-tickets"><RefreshCw className="h-4 w-4" /></Button>
            </div>
            {isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <div className="space-y-2">
                {(list?.tickets || []).map((t) => (
                  <Card key={t.id} className="cursor-pointer hover-elevate" onClick={() => setSelectedTicket(t.id)} data-testid={`card-ticket-${t.id}`}>
                    <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-semibold">{t.ticketNumber}</span>
                          {statusBadge(t.status)}
                          <Badge variant="outline" className="text-[10px]">{t.priority}</Badge>
                        </div>
                        <p className="text-sm font-medium truncate mt-1">{t.subject}</p>
                        <p className="text-xs text-muted-foreground">{t.requesterEmail} · {fmt(t.lastMessageAt)}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {list && list.tickets.length === 0 && <p className="text-sm text-muted-foreground p-4">No tickets found.</p>}
                {totalPages > 1 && (
                  <div className="flex items-center gap-2 justify-center pt-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="button-prev-page">Previous</Button>
                    <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} data-testid="button-next-page">Next</Button>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="failures" className="space-y-2">
            {(failures || []).map((f) => (
              <Card key={f.id} data-testid={`card-failure-${f.id}`}>
                <CardContent className="p-3 flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{f.subject} → {f.toAddresses.join(", ")}</span>
                  <Badge variant="destructive" className="text-[10px]">{f.status}</Badge>
                </CardContent>
              </Card>
            ))}
            {failures?.length === 0 && <p className="text-sm text-muted-foreground p-4">No failed deliveries.</p>}
          </TabsContent>

          <TabsContent value="suppressions" className="space-y-3">
            <div className="flex gap-2 max-w-md">
              <Input placeholder="email@example.com" value={suppressInput} onChange={(e) => setSuppressInput(e.target.value)} data-testid="input-suppress-email" />
              <Button onClick={() => addSuppress.mutate()} disabled={!suppressInput.includes("@") || addSuppress.isPending} data-testid="button-add-suppression">
                <ShieldOff className="h-4 w-4 mr-1" />Suppress
              </Button>
            </div>
            {(suppressions || []).map((s) => (
              <Card key={s.id} data-testid={`card-suppression-${s.id}`}>
                <CardContent className="p-3 flex items-center justify-between gap-2 text-sm">
                  <span>{s.emailAddress} <Badge variant="outline" className="text-[10px] ml-1">{s.reason}</Badge>{!s.active && <Badge variant="secondary" className="text-[10px] ml-1">inactive</Badge>}</span>
                  {s.active && <Button variant="ghost" size="sm" onClick={() => removeSuppress.mutate(s.id)} data-testid={`button-unsuppress-${s.id}`}>Remove</Button>}
                </CardContent>
              </Card>
            ))}
            {suppressions?.length === 0 && <p className="text-sm text-muted-foreground p-4">No suppressed addresses.</p>}
          </TabsContent>

          <TabsContent value="settings">
            <SettingsPanel />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
