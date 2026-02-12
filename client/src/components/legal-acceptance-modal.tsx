import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface LegalAcceptanceModalProps {
  open: boolean;
  onAccepted: () => void;
}

export function LegalAcceptanceModal({ open, onAccepted }: LegalAcceptanceModalProps) {
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptDisclaimer, setAcceptDisclaimer] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/accept-legal", {
        acceptTerms,
        acceptPrivacy,
        acceptDisclaimer,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/legal-status"] });
      toast({ title: "Thank you", description: "You have accepted the legal agreements." });
      onAccepted();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const allAccepted = acceptTerms && acceptPrivacy && acceptDisclaimer;

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle data-testid="text-legal-modal-title">Accept Legal Agreements</DialogTitle>
          <DialogDescription>
            Before continuing, please review and accept our legal agreements.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="terms"
              checked={acceptTerms}
              onCheckedChange={(checked) => setAcceptTerms(checked === true)}
              data-testid="checkbox-terms"
            />
            <div className="grid gap-1 leading-none">
              <Label htmlFor="terms" className="cursor-pointer">
                I agree to the{" "}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline inline-flex items-center gap-1"
                  data-testid="link-terms"
                >
                  Terms of Use
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Label>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="disclaimer"
              checked={acceptDisclaimer}
              onCheckedChange={(checked) => setAcceptDisclaimer(checked === true)}
              data-testid="checkbox-disclaimer"
            />
            <div className="grid gap-1 leading-none">
              <Label htmlFor="disclaimer" className="cursor-pointer">
                I agree to the{" "}
                <a
                  href="/disclaimer"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline inline-flex items-center gap-1"
                  data-testid="link-disclaimer"
                >
                  Disclaimer
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Label>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="privacy"
              checked={acceptPrivacy}
              onCheckedChange={(checked) => setAcceptPrivacy(checked === true)}
              data-testid="checkbox-privacy"
            />
            <div className="grid gap-1 leading-none">
              <Label htmlFor="privacy" className="cursor-pointer">
                I agree to the{" "}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline inline-flex items-center gap-1"
                  data-testid="link-privacy"
                >
                  Privacy Policy
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => acceptMutation.mutate()}
            disabled={!allAccepted || acceptMutation.isPending}
            data-testid="button-accept-legal"
          >
            {acceptMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
