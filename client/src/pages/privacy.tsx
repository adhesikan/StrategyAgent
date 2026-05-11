import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer } from "lucide-react";
import { Link } from "wouter";

export default function PrivacyPage() {
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
            <CardTitle className="text-2xl" data-testid="text-page-title">Privacy Policy</CardTitle>
            <p className="text-sm text-muted-foreground">Last updated: January 2026</p>
          </CardHeader>
          <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-6">
            <section>
              <h3>A. Information We Collect</h3>
              <p>We collect the following types of information:</p>
              <ul>
                <li><strong>Account Information:</strong> Email address and name (if provided) when you create an account.</li>
                <li><strong>Usage Data:</strong> Pages viewed, features used, device type, browser information, and interaction patterns.</li>
                <li><strong>Watchlists and Alerts:</strong> Symbols you add to watchlists and alert configurations you create.</li>
                <li><strong>Market Data Requests:</strong> Symbols and timeframes you request for charts and analysis.</li>
                <li><strong>Push Notification Data:</strong> Subscription identifiers (endpoint and keys) if you enable push notifications.</li>
                <li><strong>Broker Connection Data:</strong> OAuth tokens and refresh tokens if you connect a brokerage account.</li>
              </ul>
            </section>

            <section>
              <h3>B. How We Use Information</h3>
              <p>We use your information to:</p>
              <ul>
                <li>Provide, maintain, and improve the VCP Trader AI platform operated by Sunfish Technologies LLC</li>
                <li>Authenticate your identity and manage your account</li>
                <li>Deliver alerts and notifications you have configured</li>
                <li>Maintain security and prevent fraud or abuse</li>
                <li>Provide customer support when requested</li>
                <li>Analyze usage patterns to improve our service</li>
              </ul>
            </section>

            <section>
              <h3>C. Broker Connections / OAuth</h3>
              <p>
                When you connect a brokerage account, we use OAuth authentication. We do not store your brokerage username or password. OAuth tokens are stored securely and used only to access data you have authorized. You can disconnect your brokerage account at any time through the Settings page, which will revoke our access and delete stored tokens.
              </p>
            </section>

            <section>
              <h3>D. Push Notifications</h3>
              <p>
                Push notifications are opt-in. When you enable them, we store a subscription identifier to deliver alerts to your device. You can disable push notifications at any time through your browser or device settings. We send notifications only for alerts you have configured, such as price alerts and pattern detections.
              </p>
            </section>

            <section>
              <h3>E. Cookies and Analytics</h3>
              <p>
                We use session cookies to maintain your login state and preferences. We may use privacy-friendly analytics to understand how the platform is used. We do not use cookies for advertising or cross-site tracking.
              </p>
            </section>

            <section>
              <h3>F. Data Sharing</h3>
              <p>We may share your information with:</p>
              <ul>
                <li><strong>Service Providers:</strong> Database hosting, email delivery, and push notification services that help us operate the platform.</li>
                <li><strong>Legal Requirements:</strong> When required by law, subpoena, or legal process.</li>
                <li><strong>Protection:</strong> To protect the rights, property, or safety of Sunfish Technologies LLC, VCP Trader AI, our users, or others.</li>
              </ul>
              <p><strong>We never sell your personal information to third parties.</strong></p>
            </section>

            <section>
              <h3>G. Data Retention</h3>
              <p>
                We retain your data as long as your account is active. If you request account deletion, we will delete your personal data within a reasonable timeframe (typically 30 days), except where retention is required by law or for legitimate business purposes.
              </p>
            </section>

            <section>
              <h3>H. Security</h3>
              <p>
                We implement appropriate security measures to protect your information, including encryption in transit (TLS/SSL) and at rest, access controls, and secure infrastructure. However, no system is completely secure, and we cannot guarantee absolute security.
              </p>
            </section>

            <section>
              <h3>I. Your Rights</h3>
              <p>You have the right to:</p>
              <ul>
                <li><strong>Access:</strong> Request a copy of the personal data we hold about you.</li>
                <li><strong>Correction:</strong> Request correction of inaccurate data.</li>
                <li><strong>Deletion:</strong> Request deletion of your account and personal data.</li>
              </ul>
              <p>
                To exercise these rights, please contact Sunfish Technologies LLC at support@sunfishtechnologies.com.
              </p>
            </section>

            <section>
              <h3>J. Changes to This Policy</h3>
              <p>
                We may update this Privacy Policy from time to time. We will notify you of material changes by requiring re-acceptance. The "Last updated" date at the top indicates when the policy was last revised.
              </p>
            </section>

            <section>
              <h3>Contact Us</h3>
              <p>
                If you have questions about this Privacy Policy, please contact Sunfish Technologies LLC at support@sunfishtechnologies.com.
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
