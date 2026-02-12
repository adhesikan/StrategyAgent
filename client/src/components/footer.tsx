import { Link } from "wouter";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t bg-background/95 py-4 px-6">
      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 w-full">
          <p data-testid="text-copyright">
            {currentYear} Sunfish Technologies LLC. All rights reserved.
          </p>
          <nav className="flex flex-wrap items-center gap-4">
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
      </div>
    </footer>
  );
}
