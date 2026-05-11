import { Link } from "wouter";
import { ShieldAlert } from "lucide-react";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t bg-background/95 mt-auto shrink-0" data-testid="global-footer">
      <div
        className="px-6 py-2.5 border-b bg-amber-50/60 dark:bg-amber-950/20 text-[11px] leading-snug text-amber-900 dark:text-amber-100 flex items-start gap-2"
        data-testid="global-disclaimer"
      >
        <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <p>
          <span className="font-medium">Important — Not Investment Advice.</span>{" "}
          VCP Trader AI is a software tool that surfaces algorithmically-generated
          scenarios and educational analysis. It is not a registered broker-dealer or
          investment adviser. Nothing here is a recommendation, solicitation, or offer
          to buy or sell any security. All trading decisions and orders are made solely
          by you. Live market data and order submission are available only through
          supported connected brokerage accounts. Past performance and back-tested
          results do not guarantee future outcomes. Trading involves substantial risk
          of loss, including loss of principal, and is not suitable for every investor.
          Consult a licensed financial professional before making any investment decision. Use is subject to our{" "}
          <Link href="/disclaimer" className="underline hover:no-underline">full disclaimer</Link>,{" "}
          <Link href="/terms" className="underline hover:no-underline">terms</Link>, and{" "}
          <Link href="/privacy" className="underline hover:no-underline">privacy policy</Link>.
        </p>
      </div>
      <div className="py-2 px-6 flex items-center justify-between gap-4 text-xs text-muted-foreground flex-wrap">
        <p data-testid="text-copyright">
          © {currentYear} Sunfish Technologies LLC. All rights reserved.
        </p>
        <nav className="flex items-center gap-3">
          <Link href="/terms" className="hover:text-foreground transition-colors" data-testid="link-footer-terms">
            Terms
          </Link>
          <Link href="/disclaimer" className="hover:text-foreground transition-colors" data-testid="link-footer-disclaimer">
            Disclaimer
          </Link>
          <Link href="/privacy" className="hover:text-foreground transition-colors" data-testid="link-footer-privacy">
            Privacy
          </Link>
          <Link href="/open-source" className="hover:text-foreground transition-colors" data-testid="link-footer-open-source">
            Open Source
          </Link>
        </nav>
      </div>
    </footer>
  );
}
