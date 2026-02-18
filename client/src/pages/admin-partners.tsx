import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Plus,
  Users,
  Copy,
  Check,
  Loader2,
  Handshake,
  ExternalLink,
  Eye,
  EyeOff,
  ShieldAlert,
  BookOpen,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Link2,
  Bot,
  History as HistoryIcon,
  Webhook,
  FlaskConical,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/use-auth";

interface Partner {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  logoUrl: string | null;
  primaryColor: string | null;
  createdAt: string;
  subscriberCount: number;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      data-testid="button-copy"
    >
      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
    </Button>
  );
}

function AddPartnerDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [sharedSecret, setSharedSecret] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");

  const createMutation = useMutation({
    mutationFn: async (data: { slug: string; name: string; sharedSecret: string; logoUrl?: string; primaryColor?: string }) => {
      const res = await apiRequest("POST", "/api/admin/partners", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
      toast({ title: "Partner created successfully" });
      setOpen(false);
      setSlug("");
      setName("");
      setSharedSecret("");
      setLogoUrl("");
      setPrimaryColor("");
    },
    onError: () => {
      toast({ title: "Failed to create partner", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-add-partner">
          <Plus className="w-4 h-4 mr-1" />
          Add Partner
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register New Partner</DialogTitle>
          <DialogDescription>
            Add a newsletter or signal provider that can send subscribers to your platform for automated trading.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Partner Name</Label>
            <Input
              placeholder="e.g. Strategy Fundamentals"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-partner-name"
            />
          </div>
          <div className="space-y-1">
            <Label>Slug</Label>
            <Input
              placeholder="e.g. strategy-fundamentals"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              data-testid="input-partner-slug"
            />
            <p className="text-xs text-muted-foreground">
              Used in the login URL: /api/partner/login?partner=<span className="font-mono">{slug || "slug"}</span>
            </p>
          </div>
          <div className="space-y-1">
            <Label>JWT Shared Secret</Label>
            <Input
              placeholder="Paste the shared secret for JWT verification"
              value={sharedSecret}
              onChange={(e) => setSharedSecret(e.target.value)}
              data-testid="input-partner-secret"
            />
            <p className="text-xs text-muted-foreground">
              The partner uses this secret to sign JWT tokens for subscriber login.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Logo URL (optional)</Label>
            <Input
              placeholder="https://example.com/logo.png"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              data-testid="input-partner-logo"
            />
          </div>
          <div className="space-y-1">
            <Label>Brand Color (optional)</Label>
            <Input
              placeholder="#3B82F6"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              data-testid="input-partner-color"
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() => createMutation.mutate({
              slug, name, sharedSecret,
              logoUrl: logoUrl || undefined,
              primaryColor: primaryColor || undefined,
            })}
            disabled={!slug || !name || !sharedSecret || createMutation.isPending}
            data-testid="button-submit-partner"
          >
            {createMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Create Partner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestLoginDialog({ partner }: { partner: Partner }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("testuser@example.com");
  const [name, setName] = useState("Test Trader");
  const [subscriberId, setSubscriberId] = useState(`test-${Date.now()}`);
  const [skipCheckout, setSkipCheckout] = useState(true);
  const [generatedUrl, setGeneratedUrl] = useState("");

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/partners/${partner.id}/test-login`, {
        email, name, subscriberId, skipCheckout,
      });
      return res.json();
    },
    onSuccess: (data: { loginUrl: string }) => {
      setGeneratedUrl(data.loginUrl);
    },
    onError: () => {
      toast({ title: "Failed to generate test URL", variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(val) => { setOpen(val); if (!val) setGeneratedUrl(""); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid={`button-test-login-${partner.slug}`}>
          <FlaskConical className="w-4 h-4 mr-1" />
          Test Login
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Test Partner Login</DialogTitle>
          <DialogDescription>
            Generate a test login URL that simulates a subscriber arriving from {partner.name}'s website.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label>Subscriber Email</Label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="testuser@example.com"
              data-testid="input-test-email"
            />
          </div>
          <div className="space-y-1">
            <Label>Subscriber Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Test Trader"
              data-testid="input-test-name"
            />
          </div>
          <div className="space-y-1">
            <Label>Subscriber ID</Label>
            <Input
              value={subscriberId}
              onChange={(e) => setSubscriberId(e.target.value)}
              placeholder="test-subscriber-001"
              data-testid="input-test-subscriber-id"
            />
            <p className="text-xs text-muted-foreground">
              Unique identifier for this test subscriber. Reusing the same ID will log into an existing account.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="skip-checkout"
              checked={skipCheckout}
              onCheckedChange={(val) => setSkipCheckout(val === true)}
              data-testid="checkbox-skip-checkout"
            />
            <Label htmlFor="skip-checkout" className="text-sm cursor-pointer">
              Skip Stripe checkout (auto-activate subscription for testing)
            </Label>
          </div>

          {generatedUrl && (
            <div className="space-y-2 p-3 rounded-md bg-muted/50">
              <Label className="text-xs font-medium">Test Login URL (valid for 24 hours)</Label>
              <div className="flex items-start gap-1">
                <code className="text-xs bg-muted p-2 rounded flex-1 break-all font-mono max-h-24 overflow-y-auto" data-testid="text-test-login-url">
                  {generatedUrl}
                </code>
                <CopyButton text={generatedUrl} />
              </div>
              <Button
                variant="default"
                size="sm"
                className="w-full"
                onClick={() => window.open(generatedUrl, "_blank")}
                data-testid="button-open-test-url"
              >
                <ExternalLink className="w-4 h-4 mr-1" />
                Open in New Tab
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={!email || !subscriberId || generateMutation.isPending}
            data-testid="button-generate-test-url"
          >
            {generateMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Generate URL
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PartnerCard({ partner }: { partner: Partner }) {
  const { toast } = useToast();
  const [showIntegration, setShowIntegration] = useState(false);

  const toggleMutation = useMutation({
    mutationFn: async (isActive: boolean) => {
      const res = await apiRequest("PATCH", `/api/admin/partners/${partner.id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
      toast({ title: partner.isActive ? "Partner deactivated" : "Partner activated" });
    },
  });

  const loginUrl = `${window.location.origin}/api/partner/login?token=<JWT>&partner=${partner.slug}`;

  return (
    <Card className="overflow-visible" data-testid={`card-partner-${partner.slug}`}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Handshake className="w-5 h-5 text-muted-foreground" />
            <span className="font-semibold">{partner.name}</span>
            <Badge variant="outline" className="font-mono text-xs">{partner.slug}</Badge>
            {partner.isActive ? (
              <Badge variant="default" className="bg-green-600 border-green-700">Active</Badge>
            ) : (
              <Badge variant="secondary">Inactive</Badge>
            )}
          </div>
          <Switch
            checked={partner.isActive}
            onCheckedChange={(val) => toggleMutation.mutate(val)}
            disabled={toggleMutation.isPending}
            data-testid={`switch-partner-active-${partner.slug}`}
          />
        </div>

        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
          <div className="flex items-center gap-1">
            <Users className="w-4 h-4" />
            <span data-testid={`text-subscriber-count-${partner.slug}`}>{partner.subscriberCount} subscriber{partner.subscriberCount !== 1 ? "s" : ""}</span>
          </div>
          <span>Created {new Date(partner.createdAt).toLocaleDateString()}</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowIntegration(!showIntegration)}
            data-testid={`button-integration-${partner.slug}`}
          >
            {showIntegration ? <EyeOff className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
            {showIntegration ? "Hide" : "Show"} Integration Details
          </Button>
          <TestLoginDialog partner={partner} />
        </div>

        {showIntegration && (
          <div className="space-y-3 p-3 rounded-md bg-muted/50">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Login URL (partner redirects subscribers here)</Label>
              <div className="flex items-center gap-1">
                <code className="text-xs bg-muted p-2 rounded flex-1 break-all font-mono" data-testid={`text-login-url-${partner.slug}`}>
                  {loginUrl}
                </code>
                <CopyButton text={loginUrl} />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">JWT Token Requirements</Label>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>The partner must sign a JWT with their shared secret containing these claims:</p>
                <code className="block bg-muted p-2 rounded font-mono whitespace-pre">{`{
  "sub": "subscriber-unique-id",
  "email": "subscriber@example.com",
  "name": "Subscriber Name" // optional
}`}</code>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-medium">Webhook URL (for sending trade signals)</Label>
              <div className="flex items-center gap-1">
                <code className="text-xs bg-muted p-2 rounded flex-1 break-all font-mono">
                  {window.location.origin}/api/external-alerts/webhook
                </code>
                <CopyButton text={`${window.location.origin}/api/external-alerts/webhook`} />
              </div>
              <p className="text-xs text-muted-foreground">
                Each subscriber gets their own API key (auto-provisioned on first login). Send signals with the X-API-Key header.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SetupGuide() {
  const [open, setOpen] = useState(false);

  return (
    <Card data-testid="card-setup-guide">
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-muted-foreground" />
            <CardTitle className="text-base">How Partner Integration Works</CardTitle>
          </div>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-6 pt-0">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              This system lets external newsletter or signal providers (like Strategy Fundamentals) offer their subscribers automated trade execution through your platform. Here's how everything connects:
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">1</span>
              One-Time Setup (You Do This Once Per Provider)
            </h4>
            <div className="pl-8 space-y-2 text-sm text-muted-foreground">
              <p>Click <span className="font-medium text-foreground">"Add Partner"</span> and fill in:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li><span className="font-medium text-foreground">Partner Name</span> — The display name (e.g., "Strategy Fundamentals")</li>
                <li><span className="font-medium text-foreground">Slug</span> — A URL-safe identifier (e.g., "strategy-fundamentals"). Used in the login URL.</li>
                <li><span className="font-medium text-foreground">JWT Shared Secret</span> — A secret key shared between you and the partner. They use it to sign login tokens for their subscribers.</li>
              </ul>
              <p>That's it. One entry covers all of that provider's subscribers.</p>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">2</span>
              Share With The Partner
            </h4>
            <div className="pl-8 space-y-2 text-sm text-muted-foreground">
              <p>After creating a partner, expand "Integration Details" on their card to get:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li><span className="font-medium text-foreground">Login URL</span> — The partner embeds this in their newsletter/platform. When a subscriber clicks it, they land on their personal trading dashboard.</li>
                <li><span className="font-medium text-foreground">Webhook URL</span> — Where the partner sends trade signals (entry/exit alerts).</li>
                <li><span className="font-medium text-foreground">JWT Format</span> — The partner signs a JWT with the shared secret containing <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">sub</code> (subscriber ID) and <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">email</code>.</li>
              </ul>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">3</span>
              What Each Subscriber Gets
            </h4>
            <div className="pl-8 space-y-2 text-sm text-muted-foreground">
              <p>When a subscriber clicks the partner's login link, the system automatically:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Creates their account (linked internally, isolated from full platform)</li>
                <li>Provisions a webhook API key for receiving trade signals</li>
                <li>Starts their session on a standalone partner dashboard</li>
              </ul>
              <p>From there, each subscriber independently manages:</p>
              <div className="grid gap-2 mt-2">
                <div className="flex items-start gap-2">
                  <Link2 className="w-4 h-4 mt-0.5 shrink-0" />
                  <span><span className="font-medium text-foreground">Broker Connection</span> — Connect their own Tradier or TradeStation account via OAuth</span>
                </div>
                <div className="flex items-start gap-2">
                  <Bot className="w-4 h-4 mt-0.5 shrink-0" />
                  <span><span className="font-medium text-foreground">Agent Configuration</span> — Choose Suggest or Auto mode, set risk limits, price filters</span>
                </div>
                <div className="flex items-start gap-2">
                  <HistoryIcon className="w-4 h-4 mt-0.5 shrink-0" />
                  <span><span className="font-medium text-foreground">Trade History</span> — View all signals received, executed, or skipped with reasons</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">4</span>
              How Trade Signals Flow
            </h4>
            <div className="pl-8 space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2 flex-wrap text-xs font-mono">
                <Badge variant="outline">Partner sends signal</Badge>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <Badge variant="outline">Webhook receives alert</Badge>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <Badge variant="outline">Agent evaluates risk</Badge>
                <ArrowRight className="w-3 h-3 shrink-0" />
                <Badge variant="outline">Execute or skip</Badge>
              </div>
              <p className="mt-2">
                Each subscriber's agent independently evaluates signals against their personal risk settings (position size, daily loss limit, price range, reward/risk ratio) and either suggests or auto-executes the trade.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <Webhook className="w-4 h-4" />
              Webhook Signal Format
            </h4>
            <div className="pl-6 space-y-2 text-sm text-muted-foreground">
              <p>Signals are sent as plain text via <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">POST</code> to the webhook URL with the subscriber's API key in the <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">X-API-Key</code> header:</p>
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground">Entry alert:</p>
                <code className="block text-xs bg-muted p-2 rounded font-mono">enter sym=AAPL lp=185.50 tp=195.00 sl=180.00</code>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground">Exit alert:</p>
                <code className="block text-xs bg-muted p-2 rounded font-mono">exit sym=AAPL reason='target reached' tp=195.00</code>
              </div>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function AdminPartnersPage() {
  const { user } = useAuth();
  const { data: partners = [], isLoading } = useQuery<Partner[]>({
    queryKey: ["/api/admin/partners"],
    enabled: user?.role === "admin",
  });

  if (user?.role !== "admin") {
    return (
      <div className="p-8 text-center">
        <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <h2 className="text-lg font-semibold mb-1">Admin Access Required</h2>
        <p className="text-sm text-muted-foreground">This page is only available to administrators.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Partner Management</h1>
          <p className="text-sm text-muted-foreground">
            Register and manage external signal providers for subscriber auto-trading
          </p>
        </div>
        <AddPartnerDialog />
      </div>

      <SetupGuide />

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : partners.length === 0 ? (
        <Card data-testid="card-no-partners">
          <CardContent className="py-12 text-center">
            <Handshake className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <h3 className="font-semibold mb-1">No Partners Registered</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Add a newsletter or signal provider to enable subscriber auto-trading.
            </p>
            <AddPartnerDialog />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {partners.map((p) => (
            <PartnerCard key={p.id} partner={p} />
          ))}
        </div>
      )}
    </div>
  );
}
