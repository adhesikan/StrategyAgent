import sanitizeHtml from "sanitize-html";

/** Normalize an email address for comparison/storage. */
export function normalizeEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  const addr = (match ? match[1] : raw).trim().toLowerCase();
  return addr;
}

export function extractDisplayName(raw: string): string | null {
  const match = raw.match(/^\s*"?([^"<]+?)"?\s*</);
  return match ? match[1].trim() : null;
}

export function isValidEmailAddress(addr: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addr) && addr.length <= 320;
}

/** Prevent header injection: strip CR/LF and control chars from header-bound values. */
export function stripHeaderInjection(value: string): string {
  return value.replace(/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f]/g, " ").trim();
}

/** Sanitize inbound/outbound HTML for storage and admin display. */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "a", "b", "i", "em", "strong", "u", "p", "br", "div", "span", "ul", "ol", "li",
      "blockquote", "pre", "code", "h1", "h2", "h3", "h4", "h5", "h6", "table",
      "thead", "tbody", "tr", "td", "th", "hr", "img",
    ],
    allowedAttributes: {
      a: ["href"],
      img: ["src", "alt", "width", "height"],
      "*": ["style"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["https"] },
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb/], "text-align": [/^left|right|center$/],
        "font-weight": [/^\w+$/], "font-size": [/^[\d.]+(px|em|rem|%)$/],
      },
    },
    disallowedTagsMode: "discard",
  });
}

export const FORWARD_MARKER_HEADER = "X-VCP-Forwarded";

/** Addresses we must never forward for (loop prevention). */
export function getForwardBlocklist(): string[] {
  return [
    (process.env.EMAIL_FROM_ADDRESS || "team@vcptrader.com").toLowerCase(),
    (process.env.EMAIL_FORWARD_ADDRESS || "support@sunfishtrading.com").toLowerCase(),
    (process.env.ADMIN_SUPPORT_NOTIFICATION_EMAIL || "").toLowerCase(),
    "mailer-daemon@",
    "postmaster@",
    "no-reply@",
    "noreply@",
  ].filter(Boolean);
}

/**
 * Returns true when forwarding/acknowledging this inbound message would risk a loop
 * (self-sent, forwarded already, bounce daemons, blocklisted senders).
 */
export function shouldBlockForwarding(args: {
  fromAddress: string;
  returnPath?: string | null;
  headers?: Record<string, string>;
}): boolean {
  const blocklist = getForwardBlocklist();
  const candidates = [args.fromAddress, args.returnPath]
    .filter((v): v is string => Boolean(v))
    .map((v) => normalizeEmailAddress(v));
  for (const addr of candidates) {
    for (const blocked of blocklist) {
      if (blocked.endsWith("@") ? addr.startsWith(blocked) : addr === blocked) return true;
    }
  }
  const headers = args.headers || {};
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === FORWARD_MARKER_HEADER.toLowerCase()) return true;
    if (lower === "auto-submitted" && headers[key].toLowerCase() !== "no") return true;
    if (lower === "x-auto-response-suppress") return true;
  }
  return false;
}

const TICKET_NUMBER_RE = /VCP-\d{4}-\d{6}/;

/** Extract a ticket number token from subject/headers/body text if present. */
export function extractTicketNumber(...sources: (string | undefined | null)[]): string | null {
  for (const s of sources) {
    if (!s) continue;
    const m = s.match(TICKET_NUMBER_RE);
    if (m) return m[0];
  }
  return null;
}

/** Normalize a subject for matching: lowercase, strip Re:/Fwd: prefixes and whitespace. */
export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(\s*(re|fwd?|aw|sv)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function generateTicketNumber(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const rand = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
  return `VCP-${year}-${rand}`;
}
