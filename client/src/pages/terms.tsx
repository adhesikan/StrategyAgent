import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer } from "lucide-react";
import { Link } from "wouter";

export default function TermsPage() {
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
            <CardTitle className="text-2xl" data-testid="text-page-title">Terms of Use</CardTitle>
            <p className="text-sm text-muted-foreground">Last updated: January 2026</p>
          </CardHeader>
          <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-6">
            <section>
              <h3>1. Description of Service</h3>
              <p>
                VCP Trader AI is a software platform developed and operated by Sunfish Technologies LLC that provides AI-powered strategy analysis, trade setup generation, market scanning tools, technical analysis charts, and educational resources for traders. The platform includes features such as natural language setup generation, built-in and custom strategies, interactive charts, and push notifications.
              </p>
            </section>

            <section>
              <h3>2. Educational Purpose Only</h3>
              <p>
                All information, analysis, alerts, and features provided by VCP Trader AI are for educational and informational purposes only. Nothing on this platform constitutes investment advice, financial advice, trading advice, or any other type of professional advice. You should consult with qualified professionals before making any financial decisions.
              </p>
            </section>

            <section>
              <h3>3. User Responsibility</h3>
              <p>
                You are solely responsible for all trading and investment decisions you make. VCP Trader AI provides tools and information, but any actions you take based on this information are at your own risk. You acknowledge that trading involves substantial risk of loss and may not be suitable for all investors.
              </p>
            </section>

            <section>
              <h3>4. No Warranties</h3>
              <p>
                VCP Trader AI is provided "as is" without warranties of any kind, express or implied. We do not guarantee that the service will be uninterrupted, error-free, or completely secure. Market data may be delayed, incomplete, or inaccurate. We make no warranties regarding the accuracy, reliability, or completeness of any information provided.
              </p>
            </section>

            <section>
              <h3>5. Limitation of Liability</h3>
              <p>
                To the maximum extent permitted by law, Sunfish Technologies LLC, VCP Trader AI, and its operators, developers, affiliates, and partners shall not be liable for any direct, indirect, incidental, special, consequential, or punitive damages arising from your use of the platform, including but not limited to trading losses, lost profits, or missed opportunities.
              </p>
            </section>

            <section>
              <h3>6. Indemnification</h3>
              <p>
                You agree to indemnify and hold harmless Sunfish Technologies LLC, VCP Trader AI, and its operators from any claims, damages, losses, or expenses arising from your use of the platform, your violation of these terms, or your violation of any rights of third parties.
              </p>
            </section>

            <section>
              <h3>7. Acceptable Use</h3>
              <p>
                You agree not to: (a) use the platform for any illegal purpose; (b) attempt to reverse engineer, decompile, or disassemble any part of the platform; (c) scrape, crawl, or automatically collect data from the platform; (d) interfere with or disrupt the platform's operation; (e) share your account credentials with others; (f) resell or redistribute platform data without authorization.
              </p>
            </section>

            <section>
              <h3>8. Subscription and Billing</h3>
              <p>
                If you subscribe to a paid plan, you agree to pay all applicable fees. Subscriptions automatically renew unless cancelled. Refunds are provided at our discretion. We reserve the right to change pricing with reasonable notice.
              </p>
            </section>

            <section>
              <h3>9. Termination</h3>
              <p>
                We reserve the right to suspend or terminate your account at any time, with or without cause, with or without notice. Upon termination, your right to use the platform ceases immediately. Provisions that by their nature should survive termination will survive.
              </p>
            </section>

            <section>
              <h3>10. Governing Law</h3>
              <p>
                These Terms shall be governed by and construed in accordance with the laws of the State of Delaware, USA, without regard to its conflict of law provisions.
              </p>
            </section>

            <section>
              <h3>11. Changes to Terms</h3>
              <p>
                We may update these Terms from time to time. We will notify you of material changes by requiring re-acceptance of the updated terms. Continued use of the platform after changes constitutes acceptance.
              </p>
            </section>

            <section>
              <h3>12. Contact</h3>
              <p>
                For questions about these Terms, please contact Sunfish Technologies LLC at support@sunfishtechnologies.com.
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
