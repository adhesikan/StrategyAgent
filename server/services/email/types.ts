export interface SendEmailArgs {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  tags?: { name: string; value: string }[];
  headers?: Record<string, string>;
  messageType?: string;
  userId?: string | null;
  ticketId?: string | null;
  threadKey?: string | null;
  /** Essential emails (security, account) bypass suppression for legal/operational reasons. */
  essential?: boolean;
}

export interface SendEmailResult {
  success: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface InboundEmailData {
  providerEmailId: string;
  from: string;
  fromName?: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text?: string;
  html?: string;
  headers: Record<string, string>;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  attachments: { filename: string; contentType?: string; size?: number }[];
  receivedAt?: string;
}

export const EMAIL_STATUS = {
  QUEUED: "QUEUED",
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  DELAYED: "DELAYED",
  BOUNCED: "BOUNCED",
  COMPLAINED: "COMPLAINED",
  FAILED: "FAILED",
  RECEIVED: "RECEIVED",
} as const;
