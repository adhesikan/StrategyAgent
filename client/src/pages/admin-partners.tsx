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
} from "lucide-react";
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

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowIntegration(!showIntegration)}
          data-testid={`button-integration-${partner.slug}`}
        >
          {showIntegration ? <EyeOff className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
          {showIntegration ? "Hide" : "Show"} Integration Details
        </Button>

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
