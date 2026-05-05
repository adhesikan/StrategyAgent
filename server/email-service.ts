export class EmailServiceError extends Error {
  constructor(message: string, public code: string = "email_error") {
    super(message);
    this.name = "EmailServiceError";
  }
}

export interface EmailRecipient {
  email: string;
  userId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export interface SendCampaignArgs {
  subject: string;
  html: string;
  recipients: EmailRecipient[];
  fromEmail?: string;
  fromName?: string;
}

export interface SendCampaignResult {
  sent: number;
  failed: number;
  provider: string;
}

function isProviderConfigured(): { provider: string | null; reason?: string } {
  if (process.env.SENDGRID_API_KEY) return { provider: "sendgrid" };
  if (process.env.RESEND_API_KEY) return { provider: "resend" };
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return { provider: "smtp" };
  }
  return {
    provider: null,
    reason:
      "No email provider is configured. Set SENDGRID_API_KEY, RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASS in environment secrets.",
  };
}

async function sendViaSendGrid(args: SendCampaignArgs): Promise<SendCampaignResult> {
  const apiKey = process.env.SENDGRID_API_KEY!;
  const from = args.fromEmail || process.env.EMAIL_FROM_ADDRESS;
  const fromName = args.fromName || process.env.EMAIL_FROM_NAME || "Strategy Agent";
  if (!from) {
    throw new EmailServiceError(
      "EMAIL_FROM_ADDRESS is not configured. Add a verified sender address.",
      "missing_from",
    );
  }

  const personalizations = args.recipients.map((r) => ({
    to: [{ email: r.email, name: [r.firstName, r.lastName].filter(Boolean).join(" ") || undefined }],
  }));

  const payload = {
    personalizations,
    from: { email: from, name: fromName },
    subject: args.subject,
    content: [{ type: "text/html", value: args.html }],
  };

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new EmailServiceError(
      `SendGrid responded ${res.status}: ${body.slice(0, 200)}`,
      "provider_error",
    );
  }
  return { sent: args.recipients.length, failed: 0, provider: "sendgrid" };
}

export async function sendCampaign(args: SendCampaignArgs): Promise<SendCampaignResult> {
  if (args.recipients.length === 0) {
    throw new EmailServiceError("No recipients to send to.", "no_recipients");
  }
  const { provider, reason } = isProviderConfigured();
  if (!provider) {
    throw new EmailServiceError(reason!, "provider_not_configured");
  }
  if (provider === "sendgrid") {
    return sendViaSendGrid(args);
  }
  throw new EmailServiceError(
    `Email provider "${provider}" is recognized but not yet implemented in this build.`,
    "provider_unsupported",
  );
}

export function getEmailProviderStatus() {
  const { provider, reason } = isProviderConfigured();
  return {
    configured: provider !== null,
    provider,
    fromAddress: process.env.EMAIL_FROM_ADDRESS || null,
    reason: reason || null,
  };
}
