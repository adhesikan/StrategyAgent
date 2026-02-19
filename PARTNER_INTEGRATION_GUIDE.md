# Partner Integration Guide

## Overview

This guide covers how external newsletter platforms integrate with VCP Trader to offer autonomous trade execution to their subscribers. The system uses a **broadcast webhook** model: the partner sends one API call per trade signal, and VCP Trader automatically delivers it to all active subscribers.

---

## Architecture

```
Partner Newsletter Platform
         │
         ▼
  ┌──────────────────────┐
  │  Broadcast Webhook    │  ← Single API call per signal
  │  POST /api/partner/   │
  │  alerts/broadcast     │
  └──────┬───────────────┘
         │
         ▼
  ┌──────────────────────┐
  │  VCP Trader Backend   │  ← Fans out to all active subscribers
  │                       │
  │  ┌─────────────────┐  │
  │  │ Subscriber 1    │  │  → Auto-executes via broker
  │  │ Subscriber 2    │  │  → Auto-executes via broker
  │  │ Subscriber N    │  │  → Auto-executes via broker
  │  └─────────────────┘  │
  └───────────────────────┘
```

---

## Step 1: Partner Registration (Admin)

An admin creates the partner in the VCP Trader admin panel (`/admin/partners`). This generates:

- **Partner Slug** — unique identifier (e.g., `strategy-fundamentals`)
- **Shared Secret** — used to sign JWT tokens for subscriber login
- **Broadcast API Key** — used to authenticate trade signals (format: `pk_<slug>_<hex>`)

---

## Step 2: Subscriber Onboarding

### JWT-Based Login

The partner creates a signed JWT for each subscriber and redirects them to:

```
GET /api/partner/login?token=<JWT>&partner=<slug>
```

**JWT Claims** (signed with the partner's shared secret using HS256):

```json
{
  "sub": "subscriber-unique-id",
  "email": "subscriber@example.com",
  "name": "Subscriber Name"
}
```

- `sub` (required): Stable, unique subscriber identifier from the partner's system
- `email` (required): Subscriber's email address
- `name` (optional): Display name

On first login, VCP Trader:
1. Creates a linked user account
2. Creates a partner_user record
3. Redirects to the subscriber's personal trading dashboard at `/partner/dashboard`

---

## Step 3: Sending Trade Signals (Broadcast Webhook)

### Endpoint

```
POST /api/partner/alerts/broadcast
```

### Authentication

Two methods are supported:

**Method 1: Token in URL (recommended for relay targets like Strategy Fundamentals)**

Embed the API key as a `token` query parameter:
```
POST /api/partner/alerts/broadcast?token=pk_strategy-fundamentals_abc123...
```
This is the full URL you paste into Strategy Fundamentals' "Webhook URL" field when adding a relay target. No custom headers needed.

**Method 2: X-API-Key header**

Include the partner's broadcast API key in the `X-API-Key` header:
```
X-API-Key: pk_strategy-fundamentals_abc123...
```

### Payload Formats

The endpoint supports two payload formats:

#### Format A: Raw Text (Strategy Fundamentals Style)

**Entry signal:**
```json
{
  "rawText": "enter sym=PWR lp=534.78 tp=584.9 sl=408.36"
}
```

**Exit signal:**
```json
{
  "rawText": "exit sym=WDC reason=\"Stop Loss\" sl=115.4"
}
```

Optional fields with raw text:
```json
{
  "rawText": "enter sym=AAPL lp=185.50 tp=195.00 sl=180.00",
  "strategy_name": "Momentum Breakout",
  "strategy_group": "swing-trades"
}
```

#### Format B: Structured JSON

```json
{
  "symbol": "AAPL",
  "direction": "Long",
  "strategy_name": "Momentum Breakout",
  "entry_price": 185.50,
  "risk_price": 180.00,
  "target_price": 195.00
}
```

### Response

```json
{
  "success": true,
  "symbol": "AAPL",
  "alertType": "entry",
  "totalSubscribers": 42,
  "delivered": 42,
  "failed": 0
}
```

### Error Responses

| Status | Meaning |
|--------|---------|
| 401 | Missing or invalid API key |
| 400 | Invalid payload format |
| 500 | Internal server error |

---

## Step 4: Subscriber Configuration

After logging in, each subscriber configures their own:

- **Broker Connection** — Links their brokerage account (Tradier, TradeStation, or SnapTrade)
- **Agent Mode** — Alerts Only, Assisted, or Autonomous
- **Risk Controls** — Daily loss limit, max position size, kill switch
- **Bracket Orders** — Custom stop-loss and profit-target pricing methods

Autonomous mode requires explicit consent acknowledgment (stored for compliance).

---

## Step 5: Subscription (Stripe)

Subscribers must have an active $39/month subscription to use auto-trading features. The paywall is shown automatically on the partner dashboard for unsubscribed users.

---

## Example: cURL Integration

```bash
# Send an entry signal to all active subscribers
curl -X POST https://your-domain.com/api/partner/alerts/broadcast \
  -H "Content-Type: application/json" \
  -H "X-API-Key: pk_your-slug_your-api-key-here" \
  -d '{"rawText": "enter sym=AAPL lp=185.50 tp=195.00 sl=180.00"}'
```

```bash
# Send an exit signal
curl -X POST https://your-domain.com/api/partner/alerts/broadcast \
  -H "Content-Type: application/json" \
  -H "X-API-Key: pk_your-slug_your-api-key-here" \
  -d '{"rawText": "exit sym=AAPL reason=\"Target Hit\" sl=180.00"}'
```

---

## API Key Management

- API keys are generated when a partner is created
- Keys can be regenerated from the admin panel (old key immediately stops working)
- Key format: `pk_<partner-slug>_<48-char-hex>`
- Keys are partner-level (not per-subscriber)

---

## Security Notes

- All webhook requests require the `X-API-Key` header
- JWT tokens for subscriber login must be signed with the partner's shared secret
- Subscriber data is isolated — each subscriber can only see their own trades
- Auto-mode consent is recorded with timestamp, IP, and user agent for compliance
