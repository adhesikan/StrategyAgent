# VCP Trader AI — UI Specification Export

Generated: July 23, 2026
Stack: React 18 + TypeScript + Vite · Tailwind CSS · shadcn/ui (Radix) · Wouter routing · TanStack Query · lucide-react icons · TradingView lightweight-charts · PWA

---

## 1. Design Tokens

Tokens are defined as CSS custom properties in `client/src/index.css` (`:root` = light, `.dark` = dark) and mapped in `tailwind.config.ts`. Dark mode is class-based (`darkMode: ["class"]`).

### Color tokens (HSL: hue saturation% lightness%)

| Token | Light | Dark |
|---|---|---|
| `--background` | 0 0% 100% (white) | 0 0% 7% (near-black) |
| `--foreground` | 240 28% 14% | 0 0% 96% |
| `--border` | 220 13% 91% | 0 0% 16% |
| `--card` / `--card-border` | 0 0% 100% / 220 13% 91% | 0 0% 9% / 0 0% 12% |
| `--popover` | 0 0% 100% | 0 0% 13% |
| `--primary` / `--primary-foreground` | 240 28% 14% / white | **217 91% 50% (brand blue)** / 217 91% 98% |
| `--secondary` | 217 6% 86% | 217 6% 18% |
| `--muted` / `--muted-foreground` | 217 8% 92% / 217 8% 40% | 217 8% 20% / 217 8% 70% |
| `--accent` | 217 12% 90% | 217 12% 18% |
| `--destructive` | 0 84% 40% | 0 84% 35% |
| `--input` | 0 0% 75% | 0 0% 28% |
| `--ring` | 217 91% 35% | 217 91% 50% |
| `--chart-1…5` | blue 217 / green 142 / violet 271 / orange 32 / rose 340 (35–40% L) | same hues at 55–65% L |
| `--sidebar` family | white surface, dark-navy primary | 0 0% 11% surface, blue-500 primary |
| `status.*` (tailwind) | online `rgb(34 197 94)`, away `rgb(245 158 11)`, busy `rgb(239 68 68)`, offline `rgb(156 163 175)` | same |

Interaction/elevation tokens: `--elevate-1` (3–4% overlay), `--elevate-2` (8–9% overlay), `--button-outline`, `--badge-outline`, `--opaque-button-border-intensity` (computed borders for opaque buttons via CSS `hsl(from …)` with fallbacks).

### Typography

- Sans (default body/UI): **Inter**, fallback Open Sans, system-ui
- Mono (prices, code): **Roboto Mono**, fallback Menlo
- Serif (rarely used): Georgia
- Tracking normal 0em; base spacing unit `--spacing: 0.25rem`

### Radius & shadows

- `--radius: 0.5rem`; Tailwind radii: `lg` 9px, `md` 6px, `sm` 3px
- Shadows are intentionally flat (all shadow tokens ~0 alpha) — depth is conveyed with borders + elevation overlays, not drop shadows

### Semantic accent conventions (used consistently across banners/badges)

- **Emerald/green** — live data, positive P&L, pass states
- **Amber** — illustrative/sample data, warnings, disconnected-broker notices
- **Sky/blue** — daily-close (Twelve Data) data notices, informational banners
- **Rose/red** — losses, destructive actions, errors
- Light-mode contrast overrides in `index.css` remap 200–400-level tinted text (emerald/rose/amber/sky/blue/violet/orange/zinc/green/red) to 700-level shades so dark-styled cards remain legible on light backgrounds.

---

## 2. Navigation

### Top navigation bar (`client/src/components/top-nav.tsx`)
Fixed header, max-width 1600px, brand logo links to `/home`. Primary links (icon + label; label hidden below `sm`):

| Label | Route |
|---|---|
| Ideas | `/home` |
| Scanner | `/scanner` |
| Markets | `/markets` |
| Congress | `/markets/congress-activity` |
| Journal | `/journal` |
| Ask AI | `/ask` |

Right side: broker-status pill ("No broker" / "Sandbox: {provider}" / "Live: {provider}" — hidden below `md`), alerts bell (`/alerts?tab=history`), User Guide link (label hidden below `lg`), theme toggle, and user dropdown menu (Settings, Admin for admins, default-landing-page selector, logout).

### Legacy/secondary navigation
- `trading-shell.tsx` wraps in-app pages and renders the global `ComplianceFooter`.
- Public landing (`/`) has its own marketing header: Features / Stocks / Options / InstaTrade® / Pricing / FAQ + Login + "Start Free Trial" CTA.
- Admin pages are reached from the user menu (`/admin` home links out to users/emails/support/sessions/market-data/etc.).

Note: `replit.md` references an older sidebar + mobile bottom nav (`app-sidebar.tsx`, `mobile-bottom-nav.tsx`); those components no longer exist — the current shell is the top-nav layout described above.

---

## 3. Shared Components

### shadcn/ui primitives (`client/src/components/ui/`, 47 components)
accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button, calendar, card, carousel, chart, checkbox, collapsible, command, context-menu, dialog, drawer, dropdown-menu, form, hover-card, input, input-otp, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, slider, switch, table, tabs, textarea, toast/toaster, toggle, toggle-group, tooltip.

### App-level shared components (selected, `client/src/components/`)
- **Trading**: `stock-trade-ticket` / `option-trade-ticket` (sheet-based InstaTrade® tickets with required acknowledgment checkbox), `trade-setup-card`, `setup-detail-drawer`, `price-chart` (TradingView lightweight-charts), `live-trading-setup` (inline live-setup dialog), `position-protection-panel`, `live-positions-panel`
- **Data status & compliance**: `status-banner` (sample vs daily vs live data wording), `data-attribution` (`TwelveDataLink`, `DataAttribution`, `DataSourcesList` — licensing attribution), `footer` (full §12 disclaimer), `trial-banner`, `quota-banner`, `feature-lock`, `legal-acceptance-modal`
- **Onboarding**: `start-choice` (StartChoiceDialog, QuickSetupDialog), `onboarding-wizard`, `marketing-onboarding-wizard`, `welcome-tutorial`, `interactive-tutorial`, `persona-selector`
- **Scanner**: `scanner-filters`, `scanner-table`, `strategy-selector`
- **Home** (`components/home/`): `ai-snapshot-panel`, `daily-opportunities`, `quick-prompt-bar`, `popular-chips`, `home-sections`, `new-here-badge`
- **Misc**: `help-link` (contextual `?` deep-links to `/guide`), `help-assistant`, `info-tooltip`, `theme-toggle`, `congressflow-embed` (hardened external iframe), `upgrade-modal`, `plan-selector`, `pull-to-refresh`, `error-boundary`

Conventions: every interactive/meaningful element carries a `data-testid`; icons from lucide-react; forms use react-hook-form + zod via shadcn `Form`.

---

## 4. Screenshots

Captured from the running dev app (unauthenticated views; authenticated pages require login and are not capturable here):

- `landing.jpg` — public landing page (`/`): dark hero, blue accent headline, AI-scenario demo card, trust badges, cookie consent bar
- `auth.jpg` — sign-in page (`/auth` — also shown when visiting gated routes such as `/pricing` while logged out): centered card, brand logo, email/password, blue primary CTA

---

## 5. Route List (`client/src/App.tsx`, Wouter)

### Public / marketing
`/` (landing or default-landing redirect when logged in), `/pricing`, `/billing/success`, `/billing/cancel`, `/terms`, `/disclaimer`, `/privacy`, `/open-source`, `/snaptrade/callback`

### Core app (authenticated)
| Route | Page |
|---|---|
| `/home` | HomeV2 (Ideas dashboard) |
| `/ask` | Ask AI |
| `/scanner`, `/discover` | Strategy Scanner |
| `/trade/:ticker` | Trade detail |
| `/instatrade` | InstaTrade® |
| `/journal`, `/history` | Journal |
| `/results` | Results |
| `/goal-mode` | Grow (goal wizard) |
| `/income-mode` | Income |
| `/trade-finder`, `/agent` | Advanced Trade Builder |
| `/opportunity-radar` | Top Opportunities |
| `/markets`, `/market-intel` | Market Intel |
| `/markets/congress-activity(/politician/:slug)` | Congress Activity |
| `/trade-setups` | Trade setups |
| `/command-center` | Command Center |
| `/news` | News |
| `/charts(/:ticker)` | Charts |
| `/backtest` | Backtest |
| `/alerts`, `/trade-alerts` | Alerts |
| `/daily-analysis` | Daily Analysis (entitlement-gated) |
| `/settings`, `/settings/risk-profile`, `/settings/universes` | Settings |
| `/guide(/:section)` | User Guide |
| `/help` | Strategy Reference |

### Admin-only (wrapped in `<AdminOnly>`)
`/automation`, `/admin`, `/admin/users`, `/admin/emails`, `/admin/support`, `/admin/sessions`, `/admin/market-data`, `/admin/partners`, `/admin/disclaimer-logs`, `/admin/position-protection`, `/admin/agent-tests`; redirects: `/execution`, `/opportunities`, `/app/automation`

### Redirects (backward compatibility)
`/signals`, `/watchlists`, `/app/stocks`, `/app/options` → `/scanner`; `/strategies`, `/my-strategies`, `/activity` → `/home`; `/broker-connections` → `/settings`; `/learn/news` → `/news`; `/strategy-guide` → `/help`

---

## 6. Responsive Behavior

- **Mobile breakpoint**: `useIsMobile()` hook — `max-width: 767px` (MOBILE_BREAKPOINT = 768). Standard Tailwind breakpoints used throughout: `sm` 640 / `md` 768 / `lg` 1024 / `xl` 1280.
- **Top nav**: nav link labels collapse to icon-only below `sm`; broker-status pill hidden below `md`; "User Guide" label hidden below `lg`; horizontal padding and gaps tighten on small screens (`px-3 md:px-6`, `gap-3 md:gap-6`); content constrained to `max-w-[1600px]`.
- **Page layouts**: content containers use `max-w-7xl mx-auto px-4 md:px-8`; card grids collapse from multi-column (`lg:grid-cols-3` / `md:grid-cols-2`) to single column on mobile; control bars stack (`flex-col sm:flex-row`).
- **Trade tickets & drawers**: shadcn `Sheet`/`Drawer` — side sheets on desktop, near-full-height bottom sheets on mobile.
- **PWA**: installable with service worker + Web Push; `pull-to-refresh` component provides native-feel refresh on touch devices.
- **Dark/light**: class-toggled theme with localStorage persistence (`theme-toggle`); light mode auto-remaps low-contrast tinted text (see Design Tokens).
- **CongressFlow iframe**: auto-height via postMessage with clamping, so the embed stays responsive inside cards and drawers.
