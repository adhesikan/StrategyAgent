import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer } from "lucide-react";
import { Link } from "wouter";

export default function DisclaimerPage() {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6 print:hidden">
          <Link href="/">
            <Button variant="ghost" size="sm" data-testid="button-back">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={handlePrint} data-testid="button-print">
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl" data-testid="text-page-title">Disclaimer</CardTitle>
            <p className="text-sm text-muted-foreground">Last updated: January 2026</p>
          </CardHeader>
          <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-4">
            <p>
              VCP Trader AI is a software platform designed to help self-directed traders and investors analyze financial markets, generate structured trade setups using AI-powered strategy analysis, and optionally execute trades based on user-defined rules.
            </p>

            <p>
              VCP Trader AI provides AI-powered strategy analysis, natural language setup generation, and monitoring tools based on widely recognized technical analysis concepts using objective data such as price, volume, and technical indicators. The platform includes built-in and custom strategies so users can learn about market patterns and independently decide which strategies, filters, and parameters to apply.
            </p>

            <p>
              VCP Trader AI includes optional, self-directed execution tools, including InstaTrade™, which allow users to send generated setups for trade execution only according to rules, conditions, and risk settings defined and authorized by the user. VCP Trader AI does not select securities or determine trade suitability for any user.
            </p>

            <p>
              All data, charts, alerts, strategy descriptions, trade setup outputs, and analysis provided by VCP Trader AI are for educational and informational purposes only and do not constitute investment advice, trading advice, recommendations, endorsements, or a solicitation to buy or sell any security or financial instrument.
            </p>

            <p>
              VCP Trader AI is not registered as an investment adviser or broker-dealer. The platform does not provide personalized investment advice, does not act in a fiduciary capacity, and does not assess the suitability of any strategy or trade for any individual user. The platform does not manage accounts, exercise discretionary trading authority, or place trades except as explicitly directed and authorized by the user through their selected brokerage.
            </p>

            <p>
              Users may place trades manually through their own brokerage accounts or may optionally use the built-in Auto Agent for automated execution. All trading activity—manual or automated—is initiated, configured, and controlled by the user and executed through the user's chosen brokerage. The platform does not hold customer funds or securities and does not have direct access to user brokerage credentials beyond what is necessary to carry out user-authorized actions.
            </p>

            <p>
              Trading and investing involve substantial risk, including the potential loss of capital. Past performance, backtested results, or hypothetical examples do not guarantee future results. Users are solely responsible for all trading decisions, automation settings, risk management choices, tax consequences, and outcomes resulting from their use of the platform.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
