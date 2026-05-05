import { useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { XCircle, ArrowLeft } from "lucide-react";

export default function BillingCancelPage() {
  const [, navigate] = useLocation();

  useEffect(() => {
    document.title = "Checkout cancelled — Strategy Agent";
  }, []);

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-5 rounded-xl border bg-card/40 backdrop-blur p-8">
        <div className="mx-auto h-14 w-14 rounded-full bg-muted flex items-center justify-center">
          <XCircle className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold" data-testid="text-cancel-title">
            Checkout cancelled
          </h1>
          <p className="text-sm text-muted-foreground">
            No worries — nothing was charged. You can keep using Strategy Agent on the free Explorer plan,
            or pick a different plan whenever you're ready.
          </p>
        </div>

        <div className="grid gap-2 pt-2">
          <Button onClick={() => navigate("/pricing")} data-testid="button-back-to-pricing">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to pricing
          </Button>
          <Button variant="outline" onClick={() => navigate("/home")} data-testid="button-go-home">
            Continue on free plan
          </Button>
        </div>
      </div>
    </div>
  );
}
