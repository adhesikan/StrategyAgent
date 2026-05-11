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
          VCP Trader AI provides software-generated trading scenarios, market context,
          paper trading workflows, and order preparation tools for educational and
          informational purposes only. VCP Trader AI is not a broker-dealer, investment
          adviser, fiduciary, or data vendor and does not provide personalized investment
          advice. Trading stocks and options involves risk, including loss of principal.
          Paper Mode uses simulated execution and delayed, snapshot, sandbox, or estimated
          market context. Live market data, options chains, account balances, positions,
          and order submission are available only through your supported connected
          brokerage account, subject to your broker's entitlements. Past performance and
          back-tested results do not guarantee future outcomes. You are solely
          responsible for every trading decision and order. Use is subject to our{" "}
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
