import { describe, it, expect } from "vitest";
import {
  normalizeEmailAddress,
  extractDisplayName,
  isValidEmailAddress,
  stripHeaderInjection,
  sanitizeEmailHtml,
  shouldBlockForwarding,
  extractTicketNumber,
  normalizeSubject,
  generateTicketNumber,
  FORWARD_MARKER_HEADER,
} from "./email-utils";

describe("normalizeEmailAddress", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmailAddress("  Team@VCPTrader.COM ")).toBe("team@vcptrader.com");
  });
  it("extracts address from display-name format", () => {
    expect(normalizeEmailAddress('"Jane Doe" <Jane@Example.com>')).toBe("jane@example.com");
  });
});

describe("extractDisplayName", () => {
  it("returns display name when present", () => {
    expect(extractDisplayName('"Jane Doe" <jane@example.com>')).toBe("Jane Doe");
  });
  it("returns null for bare address", () => {
    expect(extractDisplayName("jane@example.com")).toBeNull();
  });
});

describe("isValidEmailAddress", () => {
  it("accepts valid addresses", () => {
    expect(isValidEmailAddress("a@b.co")).toBe(true);
  });
  it("rejects invalid addresses", () => {
    expect(isValidEmailAddress("not-an-email")).toBe(false);
    expect(isValidEmailAddress("a@b")).toBe(false);
  });
});

describe("stripHeaderInjection", () => {
  it("removes CR/LF sequences", () => {
    expect(stripHeaderInjection("Hello\r\nBcc: evil@x.com")).not.toMatch(/[\r\n]/);
  });
  it("leaves normal strings untouched", () => {
    expect(stripHeaderInjection("Normal subject")).toBe("Normal subject");
  });
});

describe("sanitizeEmailHtml", () => {
  it("strips script tags", () => {
    const out = sanitizeEmailHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain("<p>hi</p>");
    expect(out).not.toContain("script");
  });
  it("strips event handlers", () => {
    const out = sanitizeEmailHtml('<img src="x" onerror="alert(1)">');
    expect(out).not.toContain("onerror");
  });
  it("keeps basic formatting", () => {
    const out = sanitizeEmailHtml("<b>bold</b> and <a href='https://x.com'>link</a>");
    expect(out).toContain("<b>bold</b>");
  });
});

describe("shouldBlockForwarding (loop protection)", () => {
  it("blocks emails carrying the forward marker header", () => {
    const res = shouldBlockForwarding({
      fromAddress: "someone@example.com",
      headers: { [FORWARD_MARKER_HEADER.toLowerCase()]: "1" },
    });
    expect(res).toBe(true);
  });
  it("blocks emails from our own sending address", () => {
    const res = shouldBlockForwarding({ fromAddress: "team@vcptrader.com", headers: {} });
    expect(res).toBe(true);
  });
  it("blocks emails from the forwarding destination", () => {
    const res = shouldBlockForwarding({ fromAddress: "support@sunfishtrading.com", headers: {} });
    expect(res).toBe(true);
  });
  it("blocks common auto-responders", () => {
    const res = shouldBlockForwarding({
      fromAddress: "user@example.com",
      headers: { "auto-submitted": "auto-replied" },
    });
    expect(res).toBe(true);
  });
  it("allows normal customer email", () => {
    const res = shouldBlockForwarding({ fromAddress: "customer@example.com", headers: {} });
    expect(res).toBe(false);
  });
});

describe("extractTicketNumber", () => {
  it("finds ticket number in subject", () => {
    expect(extractTicketNumber("Re: [VCP-2026-000123] My issue")).toBe("VCP-2026-000123");
  });
  it("checks multiple sources", () => {
    expect(extractTicketNumber(undefined, null, "body mentions VCP-2025-004567 inline")).toBe("VCP-2025-004567");
  });
  it("returns null when absent", () => {
    expect(extractTicketNumber("Hello there")).toBeNull();
  });
});

describe("normalizeSubject", () => {
  it("strips Re:/Fwd: prefixes and whitespace", () => {
    expect(normalizeSubject("Re: RE: Fwd: Help me")).toBe(normalizeSubject("Help me"));
  });
});

describe("generateTicketNumber", () => {
  it("matches VCP-YYYY-NNNNNN format", () => {
    expect(generateTicketNumber(new Date("2026-07-22T12:00:00Z"))).toMatch(/^VCP-2026-\d{6}$/);
  });
});
