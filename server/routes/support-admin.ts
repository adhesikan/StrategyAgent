import { Router } from "express";
import { db } from "../db";
import {
  emailMessages,
  emailEvents,
  supportTickets,
  supportMessages,
  emailSuppressions,
  emailSettings,
  updateEmailSettingsSchema,
} from "@shared/schema";
import { users as usersTable } from "@shared/models/auth";
import { eq, and, desc, ilike, or, sql, count } from "drizzle-orm";
import { getEmailSettings, sendSupportReply, addSuppression } from "../services/email/email-service";
import { isResendConfigured, getDefaultFrom } from "../services/email/resend-client";
import { z } from "zod";

export const supportAdminRouter = Router();

// ---------- Tickets ----------

supportAdminRouter.get("/tickets", async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const pageSize = Math.min(50, Math.max(5, parseInt(String(req.query.pageSize || "20"), 10) || 20));

    const conditions = [];
    if (status && status !== "all") conditions.push(eq(supportTickets.status, status));
    if (search) {
      conditions.push(
        or(
          ilike(supportTickets.subject, `%${search}%`),
          ilike(supportTickets.requesterEmail, `%${search}%`),
          ilike(supportTickets.ticketNumber, `%${search}%`),
        )!,
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [tickets, [{ total }]] = await Promise.all([
      db
        .select()
        .from(supportTickets)
        .where(where)
        .orderBy(desc(supportTickets.lastMessageAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: count() }).from(supportTickets).where(where),
    ]);
    res.json({ tickets, total: Number(total), page, pageSize });
  } catch (err: any) {
    console.error("[support-admin] list tickets:", err?.message);
    res.status(500).json({ message: "Failed to load tickets" });
  }
});

supportAdminRouter.get("/tickets/:id", async (req, res) => {
  try {
    const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, req.params.id)).limit(1);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    const messages = await db
      .select()
      .from(supportMessages)
      .where(eq(supportMessages.ticketId, ticket.id))
      .orderBy(supportMessages.createdAt)
      .limit(200);
    let linkedUser: { id: string; email: string; planId: string | null; subscriptionStatus: string | null } | null = null;
    if (ticket.userId) {
      const [u] = await db
        .select({
          id: usersTable.id,
          email: usersTable.email,
          planId: usersTable.planId,
          subscriptionStatus: usersTable.subscriptionStatus,
        })
        .from(usersTable)
        .where(eq(usersTable.id, ticket.userId))
        .limit(1);
      linkedUser = u || null;
    }
    const deliveries = await db
      .select({
        id: emailMessages.id,
        messageType: emailMessages.messageType,
        status: emailMessages.status,
        subject: emailMessages.subject,
        sentAt: emailMessages.sentAt,
        createdAt: emailMessages.createdAt,
      })
      .from(emailMessages)
      .where(and(eq(emailMessages.ticketId, ticket.id), eq(emailMessages.direction, "OUTBOUND")))
      .orderBy(desc(emailMessages.createdAt))
      .limit(50);
    res.json({ ticket, messages, linkedUser, deliveries });
  } catch (err: any) {
    console.error("[support-admin] ticket detail:", err?.message);
    res.status(500).json({ message: "Failed to load ticket" });
  }
});

const replySchema = z.object({ body: z.string().min(1).max(20000) });

supportAdminRouter.post("/tickets/:id/reply", async (req: any, res) => {
  try {
    const { body } = replySchema.parse(req.body);
    const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, req.params.id)).limit(1);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });

    const result = await sendSupportReply(ticket.requesterEmail, ticket.ticketNumber, body, ticket.id);
    if (!result.success) {
      return res.status(502).json({ message: `Email send failed: ${result.errorMessage}`, errorCode: result.errorCode });
    }
    await db.insert(supportMessages).values({
      ticketId: ticket.id,
      direction: "OUTBOUND",
      senderType: "admin",
      senderEmail: getDefaultFrom().address,
      bodyText: body,
    });
    await db
      .update(supportTickets)
      .set({ status: "waiting_on_customer", lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(supportTickets.id, ticket.id));
    res.json({ success: true, providerMessageId: result.providerMessageId });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
    console.error("[support-admin] reply:", err?.message);
    res.status(500).json({ message: "Failed to send reply" });
  }
});

const statusSchema = z.object({
  status: z.enum(["open", "waiting_on_customer", "resolved", "closed"]).optional(),
  category: z.string().max(50).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  note: z.string().max(5000).optional(),
});

supportAdminRouter.patch("/tickets/:id", async (req: any, res) => {
  try {
    const data = statusSchema.parse(req.body);
    const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, req.params.id)).limit(1);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (data.status) update.status = data.status;
    if (data.category) update.category = data.category;
    if (data.priority) update.priority = data.priority;
    if (data.note) {
      update.internalNotes = [
        ...(ticket.internalNotes || []),
        { authorId: req.session.userId, note: data.note, at: new Date().toISOString() },
      ];
    }
    const [updated] = await db.update(supportTickets).set(update).where(eq(supportTickets.id, ticket.id)).returning();
    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
    console.error("[support-admin] patch ticket:", err?.message);
    res.status(500).json({ message: "Failed to update ticket" });
  }
});

// ---------- Failed deliveries ----------

supportAdminRouter.get("/failed-deliveries", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(emailMessages)
      .where(and(eq(emailMessages.direction, "OUTBOUND"), sql`${emailMessages.status} IN ('FAILED','BOUNCED','COMPLAINED')`))
      .orderBy(desc(emailMessages.createdAt))
      .limit(100);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ message: "Failed to load deliveries" });
  }
});

// ---------- Suppressions ----------

supportAdminRouter.get("/suppressions", async (_req, res) => {
  try {
    const rows = await db.select().from(emailSuppressions).orderBy(desc(emailSuppressions.createdAt)).limit(200);
    res.json(rows);
  } catch {
    res.status(500).json({ message: "Failed to load suppressions" });
  }
});

supportAdminRouter.post("/suppressions", async (req, res) => {
  try {
    const { emailAddress } = z.object({ emailAddress: z.string().email() }).parse(req.body);
    await addSuppression(emailAddress, "manual", "admin");
    res.json({ success: true });
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
    res.status(500).json({ message: "Failed to add suppression" });
  }
});

supportAdminRouter.delete("/suppressions/:id", async (req, res) => {
  try {
    await db
      .update(emailSuppressions)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(emailSuppressions.id, req.params.id));
    res.json({ success: true });
  } catch {
    res.status(500).json({ message: "Failed to remove suppression" });
  }
});

// ---------- Settings ----------

supportAdminRouter.get("/settings", async (_req, res) => {
  try {
    res.json(await getEmailSettings());
  } catch {
    res.status(500).json({ message: "Failed to load email settings" });
  }
});

supportAdminRouter.put("/settings", async (req, res) => {
  try {
    const data = updateEmailSettingsSchema.parse(req.body);
    await getEmailSettings(); // ensure singleton exists
    const [updated] = await db
      .update(emailSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(emailSettings.id, "singleton"))
      .returning();
    res.json(updated);
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message });
    res.status(500).json({ message: "Failed to update email settings" });
  }
});

// ---------- Health / observability ----------

supportAdminRouter.get("/health", async (_req, res) => {
  try {
    const [lastEvent] = await db.select({ createdAt: emailEvents.createdAt }).from(emailEvents).orderBy(desc(emailEvents.createdAt)).limit(1);
    const [lastInbound] = await db
      .select({ receivedAt: emailMessages.receivedAt })
      .from(emailMessages)
      .where(eq(emailMessages.direction, "INBOUND"))
      .orderBy(desc(emailMessages.createdAt))
      .limit(1);
    const [lastOutbound] = await db
      .select({ sentAt: emailMessages.sentAt })
      .from(emailMessages)
      .where(and(eq(emailMessages.direction, "OUTBOUND"), eq(emailMessages.status, "SENT")))
      .orderBy(desc(emailMessages.createdAt))
      .limit(1);
    const [{ failedJobs }] = await db
      .select({ failedJobs: count() })
      .from(emailEvents)
      .where(eq(emailEvents.processingStatus, "failed"));
    const [{ pendingJobs }] = await db
      .select({ pendingJobs: count() })
      .from(emailEvents)
      .where(eq(emailEvents.processingStatus, "pending"));
    const recentFailures = await db
      .select({ id: emailMessages.id, subject: emailMessages.subject, status: emailMessages.status, createdAt: emailMessages.createdAt })
      .from(emailMessages)
      .where(and(eq(emailMessages.direction, "OUTBOUND"), sql`${emailMessages.status} IN ('FAILED','BOUNCED','COMPLAINED')`))
      .orderBy(desc(emailMessages.createdAt))
      .limit(10);
    res.json({
      resendConfigured: isResendConfigured(),
      webhookConfigured: Boolean(process.env.RESEND_WEBHOOK_SECRET),
      domainExpected: "vcptrader.com",
      defaultSender: getDefaultFrom().formatted,
      lastWebhookAt: lastEvent?.createdAt || null,
      lastInboundAt: lastInbound?.receivedAt || null,
      lastOutboundAt: lastOutbound?.sentAt || null,
      pendingJobs: Number(pendingJobs),
      failedJobs: Number(failedJobs),
      recentFailures,
    });
  } catch (err: any) {
    res.status(500).json({ message: "Failed to load email health" });
  }
});
