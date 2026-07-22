import { useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Landmark } from "lucide-react";
import { CongressFlowEmbed } from "@/components/congressflow-embed";
import { ComplianceFooter } from "@/components/trading-shell";
import { isValidPoliticianSlug } from "@/lib/congressflow";

export default function CongressActivityPage() {
  const [, navigate] = useLocation();
  const params = useParams<{ slug?: string }>();
  const slug = params.slug && isValidPoliticianSlug(params.slug) ? params.slug : undefined;

  useEffect(() => {
    document.title = "Congress Activity — VCP Trader AI";
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-4">
        {slug && (
          <Button
            variant="ghost"
            size="sm"
            className="mb-2 -ml-2"
            onClick={() => navigate("/markets/congress-activity")}
            data-testid="button-back-to-congress-activity"
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            All Congress Activity
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-bold" data-testid="text-congress-activity-heading">
            Congress Activity
          </h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground max-w-3xl">
          Track reported U.S. congressional stock and ETF transactions, review disclosure details, and explore
          activity by ticker, chamber, party, state, sector, transaction type, and date.
        </p>
        <p className="mt-2 text-xs text-muted-foreground max-w-3xl" role="note" data-testid="text-congress-disclosure">
          Congressional financial disclosures may be delayed, amended, incomplete, or reported as value ranges. This
          information is provided for research purposes and is not a trading signal or investment recommendation.
        </p>
      </div>

      <CongressFlowEmbed
        view={slug ? "politician" : "activity"}
        politicianSlug={slug}
        onTickerSelected={(ticker) => navigate(`/charts/${ticker}`)}
        onPoliticianSelected={({ slug: selectedSlug }) => navigate(`/markets/congress-activity/politician/${selectedSlug}`)}
      />

      <ComplianceFooter />
    </div>
  );
}
