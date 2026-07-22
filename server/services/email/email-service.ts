import { db } from "../../db";
import { emailMessages, emailSuppressions, emailSettings, type EmailSettings } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getResendClient, getDefaultFrom, getDefaultReplyTo, isResendConfigured } from "./resend-client";
import { templates } from "./email-templates";
import {
  normalizeEmailAddress,
  isValidEmailAddress,
  stripHeaderInjection,
  sanitizeEmailHtml,
} from "./email-utils";
import type { SendEmailArgs, SendEmailResult } from "./types";
import { EMAIL_STATUS } from "./types";

export async function getEmailSettings(): Promise<EmailSettings> {
  const [row] = await db.select().from(emailSettings).limit(1);
  if (row) return row;
  const [created] = await db
    .insert(emailSettings)
    .values({ id: "singleton" })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db.select().from(emailSettings).limit(1);
  return again;
}

export async function isSuppressed(address: string): Promise<boolean> {
  const normalized = normalizeEmailAddress(address);
  const [row] = await db
    .select({ id: emailSuppressions.id })
    .from(emailSuppressions)
    .where(and(eq(emailSuppressions.emailAddress, normalized), eq(emailSuppressions.active, true)))
    .limit(1);
  return Boolean(row);
}

export async function addSuppression(address: string, reason: string, source = "resend"): Promise<void> {
  const normalized = normalizeEmailAddress(address);
  await db
    .insert(emailSuppressions)
    .values({ emailAddress: normalized, reason, source, active: true })
    .onConflictDoUpdate({
      target: emailSuppressions.emailAddress,
      set: { reason, source, active: true, updatedAt: new Date() },
    });
}

/**
 * Central outbound email sender. Never throws for provider failures —
 * always returns a structured result and logs to email_messages.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const toList = (Array.isArray(args.to) ? args.to : [args.to]).map(normalizeEmailAddress);
  const invalid = toList.filter((t) => !isValidEmailAddress(t));
  if (toList.length === 0 || invalid.length > 0) {
    return { success: false, errorCode: "invalid_recipient", errorMessage: `Invalid recipient(s): ${invalid.join(", ") || "none provided"}` };
  }
  if (!isResendConfigured()) {
    return { success: false, errorCode: "provider_not_configured", errorMessage: "RESEND_API_KEY is not configured" };
  }

  // Suppression check (essential emails bypass).
  if (!args.essential) {
    const suppressed: string[] = [];
    for (const addr of toList) {
      if (await isSuppressed(addr)) suppressed.push(addr);
    }
    if (suppressed.length === toList.length) {
      return { success: false, errorCode: "suppressed", errorMessage: `All recipients suppressed: ${suppressed.join(", ")}` };
    }
  }

  const from = getDefaultFrom();
  const settings = await getEmailSettings().catch(() => null);
  const fromName = settings?.defaultSenderName || from.name;
  const replyTo = args.replyTo ? stripHeaderInjection(args.replyTo) : settings?.defaultReplyTo || getDefaultReplyTo();
  const subject = stripHeaderInjection(args.subject).slice(0, 500);

  const safeHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(args.headers || {})) {
    safeHeaders[stripHeaderInjection(k)] = stripHeaderInjection(v);
  }

  // Persist the message first so we can track failures too.
  const [record] = await db
    .insert(emailMessages)
    .values({
      provider: "resend",
      direction: "OUTBOUND",
      messageType: args.messageType || "general",
      fromAddress: from.address,
      fromName,
      toAddresses: toList,
      ccAddresses: (args.cc || []).map(normalizeEmailAddress),
      bccAddresses: (args.bcc || []).map(normalizeEmailAddress),
      replyTo,
      subject,
      textBody: args.text || null,
      sanitizedHtmlBody: args.html ? sanitizeEmailHtml(args.html) : null,
      status: EMAIL_STATUS.QUEUED,
      userId: args.userId || null,
      ticketId: args.ticketId || null,
      threadKey: args.threadKey || null,
      metadata: { tags: args.tags || [] },
    })
    .returning();

  try {
    const resend = getResendClient();
    const { data, error } = await resend.emails.send({
      from: `${stripHeaderInjection(fromName)} <${from.address}>`,
      to: toList,
      cc: args.cc?.length ? args.cc.map(normalizeEmailAddress) : undefined,
      bcc: args.bcc?.length ? args.bcc.map(normalizeEmailAddress) : undefined,
      replyTo,
      subject,
      html: args.html,
      text: args.text || " ",
      headers: Object.keys(safeHeaders).length ? safeHeaders : undefined,
      tags: args.tags,
    });
    if (error) {
      await db
        .update(emailMessages)
        .set({ status: EMAIL_STATUS.FAILED, metadata: { error: error.message }, updatedAt: new Date() })
        .where(eq(emailMessages.id, record.id));
      console.error(`[email] send failed (${args.messageType || "general"}): ${error.name}: ${error.message}`);
      return { success: false, errorCode: error.name || "provider_error", errorMessage: error.message };
    }
    await db
      .update(emailMessages)
      .set({ providerMessageId: data?.id || null, status: EMAIL_STATUS.SENT, sentAt: new Date(), updatedAt: new Date() })
      .where(eq(emailMessages.id, record.id));
    return { success: true, providerMessageId: data?.id };
  } catch (err: any) {
    await db
      .update(emailMessages)
      .set({ status: EMAIL_STATUS.FAILED, metadata: { error: String(err?.message || err) }, updatedAt: new Date() })
      .where(eq(emailMessages.id, record.id));
    console.error(`[email] send exception (${args.messageType || "general"}):`, err?.message || err);
    return { success: false, errorCode: "exception", errorMessage: String(err?.message || err) };
  }
}

// ------- Typed helpers -------

/**
 * Internal admin/business event notification (new signups, subscriptions,
 * cancellations, etc). Goes to the support inbox — never to customers.
 * Fire-and-forget safe: logs failures but never throws.
 */
export async function sendAdminEventNotification(eventTitle: string, lines: string[]) {
  const to =
    process.env.ADMIN_SUPPORT_NOTIFICATION_EMAIL ||
    process.env.EMAIL_FORWARD_ADDRESS ||
    "support@sunfishtrading.com";
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const text = `${eventTitle}\n\n${lines.join("\n")}\n\nSent automatically by VCP Trader AI.`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
    <h2 style="font-size:16px;margin:0 0 12px">${esc(eventTitle)}</h2>
    <table style="border-collapse:collapse">${lines
      .map((l) => `<tr><td style="padding:2px 0">${esc(l)}</td></tr>`)
      .join("")}</table>
    <p style="color:#666;font-size:12px;margin-top:16px">Sent automatically by VCP Trader AI.</p>
  </div>`;
  try {
    return await sendEmail({
      to,
      subject: `[VCP Trader AI] ${eventTitle}`,
      text,
      html,
      messageType: "admin_notification",
      essential: true,
      headers: { "X-VCP-Forwarded": "true" },
    });
  } catch (err: any) {
    console.warn(`[email] admin notification failed (${eventTitle}):`, err?.message || err);
    return { success: false, errorCode: "exception", errorMessage: String(err?.message || err) } as SendEmailResult;
  }
}

export async function sendWelcomeEmail(to: string, firstName?: string | null, userId?: string) {
  const t = templates.welcome(firstName);
  return sendEmail({ to, subject: "Welcome to VCP Trader AI", ...t, messageType: "welcome", userId, essential: true });
}

export async function sendEmailVerification(to: string, verifyUrl: string, userId?: string) {
  const t = templates.emailVerification(verifyUrl);
  return sendEmail({ to, subject: "Verify your email — VCP Trader AI", ...t, messageType: "email_verification", userId, essential: true });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string, userId?: string) {
  const t = templates.passwordReset(resetUrl);
  return sendEmail({ to, subject: "Reset your VCP Trader AI password", ...t, messageType: "password_reset", userId, essential: true });
}

export async function sendSecurityAlertEmail(to: string, summary: string, userId?: string) {
  const t = templates.securityAlert(summary);
  return sendEmail({ to, subject: "Security notice — VCP Trader AI", ...t, messageType: "security_alert", userId, essential: true });
}

export async function sendBrokerConnectionAlert(to: string, provider: string, statusLine: string, userId?: string) {
  const t = templates.brokerConnectionAlert(provider, statusLine);
  return sendEmail({ to, subject: `Broker connection update — ${provider}`, ...t, messageType: "broker_alert", userId, essential: true });
}

export async function sendSubscriptionConfirmation(to: string, planName: string, userId?: string) {
  const t = templates.subscriptionConfirmation(planName);
  return sendEmail({ to, subject: "Your VCP Trader AI subscription is active", ...t, messageType: "subscription_confirmation", userId, essential: true });
}

export async function sendBillingNotice(to: string, notice: string, userId?: string) {
  const t = templates.billingNotice(notice);
  return sendEmail({ to, subject: "Billing notice — VCP Trader AI", ...t, messageType: "billing_notice", userId, essential: true });
}

export async function sendTradeAlertEmail(to: string, title: string, summary: string, userId?: string) {
  const t = templates.tradeAlert(title, summary);
  return sendEmail({ to, subject: title, ...t, messageType: "trade_alert", userId });
}

export async function sendResearchReportEmail(to: string, title: string, summary: string, userId?: string) {
  const t = templates.researchReport(title, summary);
  return sendEmail({ to, subject: title, ...t, messageType: "research_report", userId });
}

export async function sendSupportAcknowledgment(to: string, ticketNumber: string, ticketId?: string) {
  const settings = await getEmailSettings().catch(() => null);
  const t = templates.supportAcknowledgment(ticketNumber, settings?.expectedResponseWording);
  return sendEmail({
    to,
    subject: `We received your message — ${ticketNumber}`,
    ...t,
    messageType: "support_ack",
    ticketId,
    threadKey: ticketNumber,
    essential: true,
  });
}

export async function sendSupportReply(to: string, ticketNumber: string, bodyText: string, ticketId?: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const bodyHtml = esc(bodyText).replace(/\n/g, "<br>");
  const t = templates.supportReply(ticketNumber, bodyHtml, bodyText);
  return sendEmail({
    to,
    subject: `Re: your support request — ${ticketNumber}`,
    ...t,
    messageType: "support_reply",
    ticketId,
    threadKey: ticketNumber,
    essential: true,
  });
}
