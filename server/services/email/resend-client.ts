import { Resend } from "resend";

let client: Resend | null = null;

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function getResendClient(): Resend {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  if (!client) {
    client = new Resend(process.env.RESEND_API_KEY);
  }
  return client;
}

export function getDefaultFrom(): { address: string; name: string; formatted: string } {
  const address = process.env.EMAIL_FROM_ADDRESS || "team@vcptrader.com";
  const name = process.env.EMAIL_FROM_NAME || "VCP Trader AI";
  return { address, name, formatted: `${name} <${address}>` };
}

export function getDefaultReplyTo(): string {
  return process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM_ADDRESS || "team@vcptrader.com";
}

export function getForwardAddress(): string {
  return process.env.EMAIL_FORWARD_ADDRESS || "support@sunfishtrading.com";
}

/** Validate required email env vars; logs a warning list, throws nothing (email is optional at boot). */
export function validateEmailEnv(): { ok: boolean; missing: string[] } {
  const required = ["RESEND_API_KEY", "EMAIL_FROM_ADDRESS"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.warn(`[email] Resend email service not fully configured. Missing: ${missing.join(", ")}`);
  } else {
    console.log(`[email] Resend configured. Sender: ${getDefaultFrom().formatted}`);
  }
  if (!process.env.RESEND_WEBHOOK_SECRET) {
    console.warn("[email] RESEND_WEBHOOK_SECRET not set — inbound webhook will reject all events.");
  }
  return { ok: missing.length === 0, missing };
}
