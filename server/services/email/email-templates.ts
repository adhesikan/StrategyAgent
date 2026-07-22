import { stripHeaderInjection } from "./email-utils";

const BRAND = "VCP Trader AI";
const SUPPORT_ADDR = "team@vcptrader.com";
const COMPANY = "Sunfish Technologies LLC";

const RESEARCH_DISCLAIMER =
  "The information in this email is software-generated and provided for informational and educational reference only. It is not financial, investment, legal, or tax advice, and it is not a recommendation to buy or sell any security.";

export type FooterKind = "transactional" | "research" | "marketing" | "support";

function appBaseUrl(): string {
  return process.env.APP_BASE_URL || "https://vcptrader.com";
}

function footerHtml(kind: FooterKind): string {
  const parts: string[] = [];
  if (kind === "research") {
    parts.push(`<p style="margin:0 0 8px 0;">${RESEARCH_DISCLAIMER}</p>`);
  }
  if (kind === "marketing") {
    parts.push(
      `<p style="margin:0 0 8px 0;"><a href="${appBaseUrl()}/settings?section=notifications" style="color:#64748b;">Manage email preferences or unsubscribe</a></p>`,
    );
  }
  parts.push(
    `<p style="margin:0;">Questions? Contact <a href="mailto:${SUPPORT_ADDR}" style="color:#64748b;">${SUPPORT_ADDR}</a> · ${BRAND} · ${COMPANY}</p>`,
  );
  return parts.join("");
}

function footerText(kind: FooterKind): string {
  const parts: string[] = [];
  if (kind === "research") parts.push(RESEARCH_DISCLAIMER);
  if (kind === "marketing") parts.push(`Manage email preferences: ${appBaseUrl()}/settings?section=notifications`);
  parts.push(`Questions? Contact ${SUPPORT_ADDR} — ${BRAND} · ${COMPANY}`);
  return parts.join("\n\n");
}

export interface TemplateArgs {
  heading: string;
  bodyHtml: string;
  bodyText: string;
  cta?: { label: string; url: string };
  footer?: FooterKind;
  preheader?: string;
}

/** Responsive, accessible branded layout with plain-text alternative. */
export function renderEmail(args: TemplateArgs): { html: string; text: string } {
  const footer = args.footer ?? "transactional";
  const cta = args.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="border-radius:8px;background:#2563eb;">
         <a href="${args.cta.url}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-weight:600;text-decoration:none;font-size:15px;" target="_blank" rel="noopener">${args.cta.label}</a>
       </td></tr></table>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${stripHeaderInjection(args.heading)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
<span style="display:none;max-height:0;overflow:hidden;">${args.preheader || ""}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="background:#0f172a;padding:20px 32px;">
    <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.3px;">${BRAND}</span>
  </td></tr>
  <tr><td style="padding:32px;">
    <h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.35;color:#0f172a;">${args.heading}</h1>
    <div style="font-size:15px;line-height:1.6;color:#334155;">${args.bodyHtml}</div>
    ${cta}
  </td></tr>
  <tr><td style="padding:20px 32px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.55;color:#64748b;">
    ${footerHtml(footer)}
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = `${BRAND}\n\n${args.heading}\n\n${args.bodyText}${args.cta ? `\n\n${args.cta.label}: ${args.cta.url}` : ""}\n\n---\n${footerText(footer)}`;
  return { html, text };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const templates = {
  welcome(firstName?: string | null) {
    const name = firstName ? `, ${esc(firstName)}` : "";
    return renderEmail({
      heading: `Welcome to ${BRAND}${name}`,
      bodyHtml: `<p>Your account is ready. Explore AI-generated stock and options analysis, connect your broker when you're ready, and review candidate scenarios with built-in risk checks.</p><p>Your 14-day free trial is active — no charge until it ends.</p>`,
      bodyText: `Your account is ready. Explore AI-generated stock and options analysis, connect your broker when you're ready, and review candidate scenarios with built-in risk checks.\n\nYour 14-day free trial is active — no charge until it ends.`,
      cta: { label: "Open your dashboard", url: `${appBaseUrl()}/home` },
      footer: "transactional",
      preheader: "Your VCP Trader AI account is ready.",
    });
  },
  emailVerification(verifyUrl: string) {
    return renderEmail({
      heading: "Verify your email address",
      bodyHtml: `<p>Confirm this email address to secure your ${BRAND} account. This link expires soon. If you didn't create an account, you can ignore this message.</p>`,
      bodyText: `Confirm this email address to secure your ${BRAND} account. This link expires soon. If you didn't create an account, you can ignore this message.`,
      cta: { label: "Verify email", url: verifyUrl },
      footer: "transactional",
    });
  },
  passwordReset(resetUrl: string) {
    return renderEmail({
      heading: "Reset your password",
      bodyHtml: `<p>We received a request to reset your ${BRAND} password. If this was you, use the button below. If not, you can safely ignore this email — your password is unchanged.</p>`,
      bodyText: `We received a request to reset your ${BRAND} password. If this was you, use the link below. If not, you can safely ignore this email — your password is unchanged.`,
      cta: { label: "Reset password", url: resetUrl },
      footer: "transactional",
    });
  },
  securityAlert(summary: string) {
    return renderEmail({
      heading: "Security notice for your account",
      bodyHtml: `<p>${esc(summary)}</p><p>If this wasn't you, change your password immediately and contact us at ${SUPPORT_ADDR}.</p>`,
      bodyText: `${summary}\n\nIf this wasn't you, change your password immediately and contact us at ${SUPPORT_ADDR}.`,
      cta: { label: "Review account settings", url: `${appBaseUrl()}/settings?section=account` },
      footer: "transactional",
    });
  },
  brokerConnectionAlert(provider: string, statusLine: string) {
    return renderEmail({
      heading: `Broker connection update — ${esc(provider)}`,
      bodyHtml: `<p>${esc(statusLine)}</p><p>No order, position, balance, or credential details are included in email for your security.</p>`,
      bodyText: `${statusLine}\n\nNo order, position, balance, or credential details are included in email for your security.`,
      cta: { label: "Manage broker connections", url: `${appBaseUrl()}/settings?section=broker` },
      footer: "transactional",
    });
  },
  subscriptionConfirmation(planName: string) {
    return renderEmail({
      heading: "Subscription confirmed",
      bodyHtml: `<p>Your subscription to <strong>${esc(planName)}</strong> is active. Manage billing, invoices, and your payment method any time from Settings.</p>`,
      bodyText: `Your subscription to ${planName} is active. Manage billing, invoices, and your payment method any time from Settings.`,
      cta: { label: "View plan & billing", url: `${appBaseUrl()}/settings?section=billing` },
      footer: "transactional",
    });
  },
  billingNotice(notice: string) {
    return renderEmail({
      heading: "Billing notice",
      bodyHtml: `<p>${esc(notice)}</p>`,
      bodyText: notice,
      cta: { label: "Review billing", url: `${appBaseUrl()}/settings?section=billing` },
      footer: "transactional",
    });
  },
  tradeAlert(title: string, summary: string) {
    return renderEmail({
      heading: esc(title),
      bodyHtml: `<p>${esc(summary)}</p><p>Sign in to review the full analysis. Order details, positions, and account data are never included in email.</p>`,
      bodyText: `${summary}\n\nSign in to review the full analysis. Order details, positions, and account data are never included in email.`,
      cta: { label: "Review in app", url: `${appBaseUrl()}/home` },
      footer: "research",
    });
  },
  researchReport(title: string, summary: string) {
    return renderEmail({
      heading: esc(title),
      bodyHtml: `<p>${esc(summary)}</p>`,
      bodyText: summary,
      cta: { label: "Read the report", url: `${appBaseUrl()}/daily-analysis` },
      footer: "research",
    });
  },
  supportAcknowledgment(ticketNumber: string, expectedResponseWording?: string | null) {
    const extra = expectedResponseWording ? `<p>${esc(expectedResponseWording)}</p>` : "";
    const extraText = expectedResponseWording ? `\n\n${expectedResponseWording}` : "";
    return renderEmail({
      heading: `We received your message — ${ticketNumber}`,
      bodyHtml: `<p>Thanks for reaching out. Your request has been logged as ticket <strong>${ticketNumber}</strong> and our team will review it.</p>${extra}<p>For urgent account-security issues, change your password from Settings right away and mention "security" in your reply.</p><p>Please note we cannot provide individualized trading or investment advice.</p>`,
      bodyText: `Thanks for reaching out. Your request has been logged as ticket ${ticketNumber} and our team will review it.${extraText}\n\nFor urgent account-security issues, change your password from Settings right away and mention "security" in your reply.\n\nPlease note we cannot provide individualized trading or investment advice.`,
      footer: "support",
    });
  },
  supportReply(ticketNumber: string, bodyHtml: string, bodyText: string) {
    return renderEmail({
      heading: `Re: your support request ${ticketNumber}`,
      bodyHtml,
      bodyText,
      footer: "support",
    });
  },
};
