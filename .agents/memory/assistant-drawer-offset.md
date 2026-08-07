---
name: Assistant drawer top offset fix
description: Sprint 2.2.3 header-offset fix — desktop drawer was hidden behind the sticky navbar; fixed with CSS variable and z-index policy.
---

## Root cause
Desktop drawer: `fixed right-0 top-0 bottom-0 z-40`.
TopNav: `sticky top-0 z-50 h-14` (56px).
Since z-40 < z-50, the navbar covered the first 56px of the drawer (title + X button).

## Fix
- Added `--app-shell-top: 3.5rem` (56px) to `client/src/index.css` `:root`.
- Desktop drawer: removed `top-0 bottom-0 z-40`; replaced with `z-50` + inline `style={{ top: APP_SHELL_TOP_VAR, height: 'calc(100dvh - var(--app-shell-top))' }}`.
- Added desktop backdrop: `fixed inset-x-0 bottom-0 z-[49]` with same top offset.
- Mobile sheet unchanged: `fixed bottom-0 z-50 max-h-[80vh]`.

## Layout tokens (exported from workspace-assistant.tsx for tests)
- `APP_SHELL_TOP_VAR = "var(--app-shell-top)"`
- `APP_SHELL_TOP_REM = 3.5` — must match `--app-shell-top` in index.css.

## Z-index policy
- Workspace content: z-10 (internal)
- TopNav: z-50 (sticky)
- Desktop backdrop: z-[49]
- Desktop drawer: z-50 (starts below nav, no visual conflict)
- Mobile backdrop: z-40
- Mobile sheet: z-50

## StatusBanner note
The StatusBanner variants render in normal document flow (not sticky/fixed). Only the sticky navbar contributes to the fixed offset. If the banner ever becomes sticky/fixed, `APP_SHELL_TOP_REM` must increase and `--app-shell-top` must be updated.

**Why:**
`top-0` with a lower z-index than the navbar is the classic "drawer behind header" bug. The fix: position the drawer below the header using a shared CSS variable, and raise z-index so it's on top of page content (but still starts below the navbar vertically).
