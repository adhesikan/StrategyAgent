---
name: Workspace scroll regression fix
description: Root causes and fixes for the scroll/nav regression in the AI Trading Workspace tab.
---

## Root causes (confirmed)

1. **activeBtnRef.current.scrollIntoView()** in the nav's useEffect called scrollIntoView on the active pill, which scrolled ALL ancestors (including the page) on every activeId change — fighting the user's scroll position. Fixed: replaced with manual `nav.scrollLeft` / `nav.scrollTo()` manipulation, which only affects the nav's horizontal overflow container.

2. **findActiveSectionId returned FIRST visible** — with rootMargin "0px 0px -60% 0px" and threshold 0.2, multiple sections were in the detection zone simultaneously. Returning the FIRST always left the active pill on "Summary". Fixed: changed to return the LAST visible section (furthest down DOM order = section most recently scrolled into). Also switched from IntersectionObserver to scroll-position/getBoundingClientRect detection for reliability.

3. **No scroll-margin-top on sections** — scrollIntoView({block:"start"}) put section tops at position 0 of scroll container, directly behind the sticky workspace nav (~30px). Sections appeared scrolled-to but headings were hidden. Fixed: global CSS `[id^="ws-"] { scroll-margin-top: 52px; }` in index.css. scrollIntoView respects this natively.

4. **No body scroll lock on mobile** — the mobile bottom sheet had a visual backdrop but body scroll was not locked. Fixed: useEffect in WorkspaceAssistantDrawer (before the `if (!open) return null`) locks body.style.overflow when open and mobile (< 1024px). Restores previous value on cleanup. Pure helper `shouldLockScroll(open, viewportWidth)` exported for testing.

## Key design decisions

- **findActiveSectionId** semantics: LAST visible in sections array = section we've scrolled into. First section (index 0) is the fallback when nothing is visible (user is above all sections).
- **useActiveSection** replaces IntersectionObserver with scroll event + getBoundingClientRect. Listens on both window AND the nearest scrollable ancestor (for PullToRefresh / nested overflow:auto containers). Throttled via requestAnimationFrame.
- **WS_SCROLL_MARGIN_TOP = 52** is exported as a constant. Both the CSS rule and the useActiveSection THRESHOLD (scroll detection offset) use this value.
- **shouldLockScroll** is a pure function (no DOM) — exported from workspace-assistant.tsx for unit testing without jsdom.

## Test files changed/added
- workspace-nav.tsx: rewritten (findActiveSectionId, useActiveSection, WS_SCROLL_MARGIN_TOP exported)
- workspace-assistant.tsx: shouldLockScroll added; WorkspaceAssistantDrawer scroll lock via useEffect before conditional return
- workspace-assistant.test.tsx: I1 (first→last) and I7 (first→last) expectations updated
- workspace-scroll.test.ts: 58 new pure tests (sections A-G)
- client/src/index.css: [id^="ws-"] scroll-margin-top rule added

## Invariant to maintain
If WS_SCROLL_MARGIN_TOP constant changes, the CSS value in index.css `scroll-margin-top: 52px` must be updated to match. Test C2 in workspace-scroll.test.ts enforces this by asserting the constant equals 52.
