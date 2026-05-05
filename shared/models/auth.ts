import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for express-session
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)]
);

export const UserRole = {
  USER: "user",
  ADMIN: "admin",
} as const;

export type UserRoleType = typeof UserRole[keyof typeof UserRole];

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique().notNull(),
  password: varchar("password").notNull(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role").default("user").notNull(),
  stripeCustomerId: varchar("stripe_customer_id"),
  subscriptionStatus: varchar("subscription_status").default("active"),
  subscriptionPlanId: varchar("subscription_plan_id"),
  subscriptionEndDate: timestamp("subscription_end_date"),
  // Persona + subscription plan system
  traderPersona: varchar("trader_persona"),
  planId: varchar("plan_id").default("free"),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  billingCycle: varchar("billing_cycle").default("monthly"),
  trialEndsAt: timestamp("trial_ends_at"),
  currentPeriodEndsAt: timestamp("current_period_ends_at"),
  dailyAnalysesUsed: integer("daily_analyses_used").default(0),
  dailyAnalysesResetAt: timestamp("daily_analyses_reset_at"),
  acceptedLegalVersion: varchar("accepted_legal_version"),
  acceptedAt: timestamp("accepted_at"),
  acceptedIp: varchar("accepted_ip"),
  acceptedUserAgent: varchar("accepted_user_agent"),
  snaptradeUserId: varchar("snaptrade_user_id"),
  snaptradeUserSecret: varchar("snaptrade_user_secret"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true,
  role: true,
  stripeCustomerId: true,
  subscriptionStatus: true,
  subscriptionPlanId: true,
  subscriptionEndDate: true,
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

// User settings table for persistent preferences
export const userSettings = pgTable("user_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  showTooltips: varchar("show_tooltips").default("true"),
  pushNotificationsEnabled: varchar("push_notifications_enabled").default("false"),
  breakoutAlertsEnabled: varchar("breakout_alerts_enabled").default("true"),
  stopAlertsEnabled: varchar("stop_alerts_enabled").default("true"),
  emaAlertsEnabled: varchar("ema_alerts_enabled").default("true"),
  approachingAlertsEnabled: varchar("approaching_alerts_enabled").default("true"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSettingsSchema = createInsertSchema(userSettings).omit({ id: true, updatedAt: true });
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
export type UserSettings = typeof userSettings.$inferSelect;

export const userSettingsUpdateSchema = z.object({
  showTooltips: z.boolean().optional(),
  pushNotificationsEnabled: z.boolean().optional(),
  breakoutAlertsEnabled: z.boolean().optional(),
  stopAlertsEnabled: z.boolean().optional(),
  emaAlertsEnabled: z.boolean().optional(),
  approachingAlertsEnabled: z.boolean().optional(),
  traderPersona: z.enum(["buyer", "seller", "complex", "learner"]).nullable().optional(),
});

export type UserSettingsUpdate = z.infer<typeof userSettingsUpdateSchema>;
