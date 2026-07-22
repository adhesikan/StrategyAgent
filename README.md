# VCP Trader AI

AI-powered stock and options intelligence platform. See `replit.md` for full architecture notes.

## Email Service (Resend)

Transactional + support email runs through Resend from `team@vcptrader.com`.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Resend API key (secret) |
| `RESEND_WEBHOOK_SECRET` | Svix signing secret for the Resend webhook (secret) |
| `EMAIL_FROM_ADDRESS` | Default sender, `team@vcptrader.com` |
| `EMAIL_FROM_NAME` | Default sender display name, `VCP Trader AI` |
| `EMAIL_REPLY_TO` | Default reply-to address |
| `EMAIL_FORWARD_ADDRESS` | Support forwarding destination, `support@sunfishtrading.com` |
| `ADMIN_SUPPORT_NOTIFICATION_EMAIL` | Optional admin notification address |

### Resend dashboard setup

1. Verify the domain `vcptrader.com` in Resend (SPF + DKIM + Return-Path DNS records).
2. Enable **Receiving** for the domain so mail to `team@vcptrader.com` is ingested.
3. Add a webhook pointing to `{APP_BASE_URL}/api/webhooks/resend` and subscribe to:
   `email.received`, `email.sent`, `email.delivered`, `email.delivery_delayed`,
   `email.bounced`, `email.complained`, `email.opened`, `email.clicked`.
4. Copy the webhook signing secret into `RESEND_WEBHOOK_SECRET`.

### How it works

- Outbound sends go through `server/services/email/email-service.ts` (suppression checks,
  header-injection guards, delivery logging to `email_messages`).
- Inbound mail hits `POST /api/webhooks/resend` (svix-verified, rate-limited, idempotent),
  is threaded into support tickets (`VCP-YYYY-NNNNNN`), forwarded to the support inbox with
  loop protection, and acknowledged to the customer once per new ticket.
- Admins manage tickets, replies, suppressions, settings, and delivery health at `/admin/support`.
- Bounces/complaints automatically add addresses to `email_suppressions`.

### Tests

```bash
npx vitest run --root . server/services/email/email-utils.test.ts
```
