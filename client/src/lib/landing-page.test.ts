// Tests for authenticated / redirect behavior (Sprint 5.5).
//
// Covers: no setting, legacy "/home" (migration), removed pages,
// explicitly pinned pages, and safety fallbacks.
//
// Product rule: "/home" is no longer a pinnable landing page.
// Users with the old "/home" DB default are migrated to "/dashboard".
// Users can still navigate to /home directly via URL or nav; they
// cannot set it as their default in Settings.

import { describe, it, expect } from "vitest";
import { resolveLandingPage, PINNABLE_LANDING_PAGES } from "./landing-page";

describe("resolveLandingPage — no setting", () => {
  it("returns /dashboard when preference is null", () => {
    expect(resolveLandingPage(null)).toBe("/dashboard");
  });

  it("returns /dashboard when preference is undefined", () => {
    expect(resolveLandingPage(undefined)).toBe("/dashboard");
  });

  it("returns /dashboard when preference is empty string", () => {
    expect(resolveLandingPage("")).toBe("/dashboard");
  });
});

describe("resolveLandingPage — legacy /home migration (Sprint 5.5)", () => {
  it("redirects legacy /home to /dashboard (DB default migration)", () => {
    // "/home" was the pre-Sprint-5.5 DB default. All users who never explicitly
    // chose a landing page have "/home" stored. They should all land on /dashboard.
    expect(resolveLandingPage("/home")).toBe("/dashboard");
  });

  it("/home is not a valid explicit pin — cannot stay as landing page", () => {
    // Even if someone submits "/home" via the Settings API, the server coercion
    // converts it to "/dashboard" before saving, and the client mirrors this rule.
    expect(resolveLandingPage("/home")).not.toBe("/home");
  });

  it("/home is not in PINNABLE_LANDING_PAGES", () => {
    expect((PINNABLE_LANDING_PAGES as readonly string[]).includes("/home")).toBe(false);
  });
});

describe("resolveLandingPage — other removed / legacy pages", () => {
  it("returns /dashboard for /journal (removed page)", () => {
    expect(resolveLandingPage("/journal")).toBe("/dashboard");
  });

  it("returns /dashboard for /history (was previously the /journal redirect target)", () => {
    expect(resolveLandingPage("/history")).toBe("/dashboard");
  });
});

describe("resolveLandingPage — explicitly pinned pages (preserved)", () => {
  it("returns /dashboard for a user who pinned /dashboard", () => {
    expect(resolveLandingPage("/dashboard")).toBe("/dashboard");
  });

  it("returns /scanner for a user who pinned /scanner", () => {
    expect(resolveLandingPage("/scanner")).toBe("/scanner");
  });

  it("returns /goal-mode when pinned", () => {
    expect(resolveLandingPage("/goal-mode")).toBe("/goal-mode");
  });

  it("returns /income-mode when pinned", () => {
    expect(resolveLandingPage("/income-mode")).toBe("/income-mode");
  });

  it("returns /trade-finder when pinned", () => {
    expect(resolveLandingPage("/trade-finder")).toBe("/trade-finder");
  });

  it("returns /markets when pinned", () => {
    expect(resolveLandingPage("/markets")).toBe("/markets");
  });

  it("returns /opportunity-radar when pinned", () => {
    expect(resolveLandingPage("/opportunity-radar")).toBe("/opportunity-radar");
  });

  it("returns /instatrade when pinned", () => {
    expect(resolveLandingPage("/instatrade")).toBe("/instatrade");
  });

  it("returns /charts when pinned", () => {
    expect(resolveLandingPage("/charts")).toBe("/charts");
  });
});

describe("resolveLandingPage — safety fallback", () => {
  it("returns /dashboard for an unrecognised path", () => {
    expect(resolveLandingPage("/some-unknown-page")).toBe("/dashboard");
  });

  it("returns /dashboard for a path with query params (not pinnable)", () => {
    expect(resolveLandingPage("/settings?tab=broker")).toBe("/dashboard");
  });

  it("returns /dashboard for an absolute URL (security: no open redirect)", () => {
    expect(resolveLandingPage("https://evil.com")).toBe("/dashboard");
  });

  it("returns /dashboard for a javascript: URI", () => {
    expect(resolveLandingPage("javascript:alert(1)")).toBe("/dashboard");
  });
});
