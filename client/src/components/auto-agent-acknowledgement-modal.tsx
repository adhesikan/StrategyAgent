import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Shield, AlertTriangle, Bot } from "lucide-react";

interface AutoAgentAcknowledgementModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function AutoAgentAcknowledgementModal({ 
  open, 
  onClose, 
  onConfirm 
}: AutoAgentAcknowledgementModalProps) {
  const [ack1, setAck1] = useState(false);
  const [ack2, setAck2] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", "/api/user-settings", {
        autoAgentAcknowledged: true,
        autoAgentAcknowledgedAt: new Date().toISOString(),
        autoAgentAckVersion: "v1",
      });
      
      await apiRequest("POST", "/api/audit-events", {
        eventType: "AUTO_AGENT_ARMED",
        metadata: { acknowledgedAt: new Date().toISOString(), version: "v1" },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-settings"] });
      toast({ title: "Auto Agent Armed", description: "You can now enable automated trading." });
      onConfirm();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save acknowledgement.", variant: "destructive" });
    },
  });

  const canConfirm = ack1 && ack2;

  const handleConfirm = () => {
    if (canConfirm) {
      saveMutation.mutate();
    }
  };

  const handleClose = () => {
    setAck1(false);
    setAck2(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Arm Auto Agent
          </DialogTitle>
          <DialogDescription>
            Before enabling automated trading, please review and acknowledge the following
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Card className="bg-yellow-500/5 border-yellow-500/20">
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-2 text-sm">
                  <p className="font-medium text-yellow-700 dark:text-yellow-400">
                    Important: User-Controlled Automation
                  </p>
                  <p className="text-muted-foreground">
                    Auto Agent executes trades based on rules you configure. You maintain full 
                    control and responsibility for all trading activity.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <div 
              className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover-elevate"
              onClick={() => setAck1(!ack1)}
              data-testid="checkbox-ack-1"
            >
              <Checkbox 
                checked={ack1} 
                onCheckedChange={(checked) => setAck1(!!checked)}
                className="mt-0.5"
              />
              <Label className="text-sm cursor-pointer leading-relaxed">
                I understand that automated actions follow rules I configured and approved. 
                The system will execute trades based on my defined criteria without requiring 
                additional confirmation.
              </Label>
            </div>

            <div 
              className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover-elevate"
              onClick={() => setAck2(!ack2)}
              data-testid="checkbox-ack-2"
            >
              <Checkbox 
                checked={ack2} 
                onCheckedChange={(checked) => setAck2(!!checked)}
                className="mt-0.5"
              />
              <Label className="text-sm cursor-pointer leading-relaxed">
                I understand that I can pause or disable automation at any time using the 
                Emergency Stop button, and I am responsible for monitoring automated activity.
              </Label>
            </div>
          </div>

          <Card className="bg-muted/50">
            <CardContent className="pt-4">
              <div className="flex items-start gap-2">
                <Shield className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  VCP Trader provides tools for self-directed traders. Automation follows your 
                  rules. You are responsible for configuration and monitoring. Not investment 
                  advice. No guarantees.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} data-testid="button-cancel-arm">
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm}
            disabled={!canConfirm || saveMutation.isPending}
            data-testid="button-confirm-arm"
          >
            {saveMutation.isPending ? "Saving..." : "Arm Auto Agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
