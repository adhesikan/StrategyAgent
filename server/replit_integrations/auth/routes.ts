import type { Express, Request, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { authStorage } from "./storage";
import { isAuthenticated } from "./sessionAuth";
import { loginSchema, registerSchema, users } from "@shared/models/auth";
import { sessionAuditEvents } from "@shared/schema";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { seedDefaultUniverse } from "../../models/ticker-universes";
import { getDefaultRiskProfile } from "../../models/risk-profiles";

function parseUserAgent(ua: string): { browser: string; os: string; deviceType: string } {
  const u = ua || "";
  let browser = "Unknown";
  let os = "Unknown";
  let deviceType = "Desktop";

  const browserMatchers: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
    [/Edg\/(\d+)/, (m) => `Edge ${m[1]}`],
    [/OPR\/(\d+)/, (m) => `Opera ${m[1]}`],
    [/Firefox\/(\d+)/, (m) => `Firefox ${m[1]}`],
    [/Chrome\/(\d+)/, (m) => `Chrome ${m[1]}`],
    [/Version\/(\d+).*Safari/, (m) => `Safari ${m[1]}`],
    [/Safari\/(\d+)/, (m) => `Safari ${m[1]}`],
  ];
  for (const [re, fmt] of browserMatchers) {
    const m = u.match(re);
    if (m) { browser = fmt(m); break; }
  }

  if (/Windows NT 10/.test(u)) os = "Windows 10/11";
  else if (/Windows NT/.test(u)) os = "Windows";
  else if (/Mac OS X/.test(u)) os = "macOS";
  else if (/Android/.test(u)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(u)) os = "iOS";
  else if (/Linux/.test(u)) os = "Linux";

  if (/iPad|Tablet/i.test(u)) deviceType = "Tablet";
  else if (/Mobile|iPhone|Android/i.test(u)) deviceType = "Mobile";

  return { browser, os, deviceType };
}

function getRequestIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  if (Array.isArray(fwd) && fwd.length) return fwd[0];
  return req.ip || "unknown";
}

function recordSessionEvent(args: {
  req: Request;
  userId: string | null;
  email: string | null;
  eventType: "login" | "logout" | "register";
}) {
  const ua = args.req.headers["user-agent"] || "";
  const parsed = parseUserAgent(ua);
  db.insert(sessionAuditEvents).values({
    userId: args.userId,
    email: args.email,
    eventType: args.eventType,
    ipAddress: getRequestIp(args.req),
    userAgent: ua.slice(0, 500),
    browser: parsed.browser,
    os: parsed.os,
    deviceType: parsed.deviceType,
  }).catch((err) => {
    console.error("[Audit] Failed to record session event:", err.message);
  });
}

const JWT_EXPIRATION = "12h";

const STARTER_WATCHLIST_SYMBOLS = [
  "AAPL", "MSFT", "NVDA", "AMD", "TSLA",
  "META", "AMZN", "GOOGL", "MU", "PLTR",
];

const starterWatchlistSeedInFlight = new Map<string, Promise<void>>();

async function seedStarterWatchlist(userId: string): Promise<void> {
  const existing = starterWatchlistSeedInFlight.get(userId);
  if (existing) return existing;
  const p = (async () => {
    try {
      const current = await storage.getWatchlists(userId);
      if (current && current.length > 0) return;
      await storage.createWatchlist({
        userId,
        name: "Starter Watchlist",
        symbols: STARTER_WATCHLIST_SYMBOLS,
      });
    } catch (err) {
      console.error("[Seed] Failed to create starter watchlist:", err);
    }
  })();
  starterWatchlistSeedInFlight.set(userId, p);
  p.finally(() => starterWatchlistSeedInFlight.delete(userId));
  return p;
}

function seedNewUser(userId: string) {
  const tasks: Promise<unknown>[] = [seedStarterWatchlist(userId)];
  if (process.env.NODE_ENV === "development") {
    tasks.push(seedDefaultUniverse(userId), getDefaultRiskProfile(userId));
  }
  Promise.all(tasks).catch((err) => console.error("[Seed] Error seeding new user:", err));
}

function getJwtSecret(): string {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret) throw new Error("AUTH_JWT_SECRET environment variable is required");
  return secret;
}

export function getUserEntitlements(_userId: string) {
  return {
    stockScanner: true,
    optionsScanner: true,
    automation: false,
    plan: "core" as const,
  };
}

export const verifyJwt: RequestHandler = (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return next();

  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
    if (decoded.sub) {
      req.session.userId = decoded.sub as string;
    }
  } catch {
  }
  next();
};

// ---- Email verification & password reset token helpers ----
import crypto from "crypto";

function generateToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function appBaseUrl(_req: Request): string {
  // Never derive from request headers — host-header poisoning could leak
  // reset/verification tokens to attacker-controlled domains.
  const envBase = process.env.APP_BASE_URL;
  if (envBase) return envBase.replace(/\/$/, "");
  const replitDomain = (process.env.REPLIT_DOMAINS || "").split(",")[0]?.trim() || process.env.REPLIT_DEV_DOMAIN;
  if (replitDomain) return `https://${replitDomain}`;
  return "http://localhost:5000";
}

/** Generates a verification token for a user and emails the verify link. Fire-and-forget safe. */
async function issueVerificationEmail(req: Request, userId: string, email: string): Promise<void> {
  const { token, hash } = generateToken();
  await db
    .update(users)
    .set({
      verificationTokenHash: hash,
      verificationTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
  const { sendEmailVerification } = await import("../../services/email/email-service");
  await sendEmailVerification(email, `${appBaseUrl(req)}/verify-email?token=${token}`, userId);
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "New password must be at least 6 characters"),
});

const updateProfileSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email("Invalid email address").optional(),
});

const LEGAL_VERSION = process.env.LEGAL_VERSION || "2026-01-01";

const acceptLegalSchema = z.object({
  acceptTerms: z.boolean().refine(v => v === true, "You must accept the terms"),
  acceptPrivacy: z.boolean().refine(v => v === true, "You must accept the privacy policy"),
  acceptDisclaimer: z.boolean().refine(v => v === true, "You must accept the disclaimer"),
});

export function registerAuthRoutes(app: Express): void {
  app.get("/api/legal/version", (req, res) => {
    res.json({ version: LEGAL_VERSION });
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const data = registerSchema.parse(req.body);
      
      const existingUser = await authStorage.getUserByEmail(data.email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      const user = await authStorage.createUser(
        data.email,
        data.password,
        data.firstName,
        data.lastName
      );

      // Auto-start the 14-day Pro trial for every new signup.
      const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      await authStorage.updateUser(user.id, {
        planId: "pro",
        subscriptionStatus: "trialing",
        trialEndsAt,
      });

      if (req.body.acceptLegal) {
        await authStorage.updateUser(user.id, {
          acceptedLegalVersion: LEGAL_VERSION,
          acceptedAt: new Date(),
          acceptedIp: req.ip || req.headers["x-forwarded-for"]?.toString() || "unknown",
          acceptedUserAgent: req.headers["user-agent"] || "unknown",
        });
      }

      req.session.userId = user.id;

      seedNewUser(user.id);
      recordSessionEvent({ req, userId: user.id, email: user.email, eventType: "register" });

      // Fire-and-forget welcome + verification emails (never block registration).
      import("../../services/email/email-service")
        .then(({ sendWelcomeEmail }) => sendWelcomeEmail(user.email, data.firstName || null, user.id))
        .catch((err) => console.warn("Welcome email failed:", err?.message || err));
      issueVerificationEmail(req, user.id, user.email)
        .catch((err) => console.warn("Verification email failed:", err?.message || err));

      const updatedUser = await authStorage.getUser(user.id);
      const { password: _, ...safeUser } = updatedUser!;
      res.status(201).json(safeUser);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("Registration error:", error);
      res.status(500).json({ message: "Failed to register" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const data = loginSchema.parse(req.body);
      
      const user = await authStorage.getUserByEmail(data.email);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      const isValid = await authStorage.validatePassword(data.password, user.password);
      if (!isValid) {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      req.session.userId = user.id;
      delete req.session.partnerUserId;
      recordSessionEvent({ req, userId: user.id, email: user.email, eventType: "login" });

      // Legacy accounts created before the 14-day trial model: start their
      // trial on first login if they've never had one and have no Stripe
      // subscription. Mirrors the auto-trial granted at registration.
      let responseUser = user;
      if (!user.trialEndsAt && !user.stripeSubscriptionId) {
        try {
          await authStorage.updateUser(user.id, {
            planId: "pro",
            subscriptionStatus: "trialing",
            trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          });
          responseUser = (await authStorage.getUser(user.id)) ?? user;
        } catch (err) {
          console.error("Failed to backfill trial on login:", err);
        }
      }

      const { password: _, ...safeUser } = responseUser;
      res.json(safeUser);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("Login error:", error);
      res.status(500).json({ message: "Failed to login" });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    const userId = req.session.userId || null;
    let email: string | null = null;
    if (userId) {
      try {
        const u = await authStorage.getUser(userId);
        email = u?.email || null;
      } catch {}
      recordSessionEvent({ req, userId, email, eventType: "logout" });
    }
    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/auth/user", isAuthenticated, async (req, res) => {
    try {
      const user = await authStorage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.post("/api/auth/accept-legal", isAuthenticated, async (req, res) => {
    try {
      acceptLegalSchema.parse(req.body);
      
      const user = await authStorage.updateUser(req.session.userId!, {
        acceptedLegalVersion: LEGAL_VERSION,
        acceptedAt: new Date(),
        acceptedIp: req.ip || req.headers["x-forwarded-for"]?.toString() || "unknown",
        acceptedUserAgent: req.headers["user-agent"] || "unknown",
      });

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("Accept legal error:", error);
      res.status(500).json({ message: "Failed to accept legal terms" });
    }
  });

  app.get("/api/auth/legal-status", isAuthenticated, async (req, res) => {
    try {
      const user = await authStorage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const isAccepted = user.acceptedLegalVersion === LEGAL_VERSION;
      res.json({
        accepted: isAccepted,
        currentVersion: LEGAL_VERSION,
        acceptedVersion: user.acceptedLegalVersion,
        acceptedAt: user.acceptedAt,
      });
    } catch (error) {
      console.error("Legal status error:", error);
      res.status(500).json({ message: "Failed to get legal status" });
    }
  });

  app.post("/api/auth/token", isAuthenticated, async (req, res) => {
    try {
      const user = await authStorage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const payload = {
        sub: user.id,
        email: user.email,
        role: user.role,
      };

      const token = jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRATION });

      console.log(`[Auth] JWT issued for user ${user.id}`);

      res.json({
        token,
        expiresIn: JWT_EXPIRATION,
        user: { id: user.id, email: user.email, role: user.role },
      });
    } catch (error) {
      console.error("[Auth] Token generation failed:", (error as Error).message);
      res.status(500).json({ message: "Failed to generate token" });
    }
  });

  // ---- Email verification ----
  app.post("/api/auth/verify-email", async (req, res) => {
    try {
      const { token } = z.object({ token: z.string().min(10).max(200) }).parse(req.body);
      const hash = hashToken(token);
      const [user] = await db.select().from(users).where(eq(users.verificationTokenHash, hash)).limit(1);
      if (!user || !user.verificationTokenExpiresAt || user.verificationTokenExpiresAt < new Date()) {
        return res.status(400).json({ message: "This verification link is invalid or has expired." });
      }
      await db
        .update(users)
        .set({ emailVerified: new Date(), verificationTokenHash: null, verificationTokenExpiresAt: null, updatedAt: new Date() })
        .where(eq(users.id, user.id));
      res.json({ message: "Email verified successfully" });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid token" });
      console.error("Verify email error:", error);
      res.status(500).json({ message: "Failed to verify email" });
    }
  });

  app.post("/api/auth/resend-verification", isAuthenticated, async (req, res) => {
    try {
      const user = await authStorage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (user.emailVerified) return res.json({ message: "Email is already verified" });
      await issueVerificationEmail(req, user.id, user.email);
      res.json({ message: "Verification email sent" });
    } catch (error) {
      console.error("Resend verification error:", error);
      res.status(500).json({ message: "Failed to send verification email" });
    }
  });

  // ---- Password reset (forgot password) ----
  const forgotAttempts = new Map<string, { count: number; windowStart: number }>();
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = z.object({ email: z.string().email() }).parse(req.body);

      // Rate limit per IP: 5/15min. When throttled, silently skip sending but
      // keep the uniform 200 response (no enumeration/probing signal).
      const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0] || req.ip || "unknown").trim();
      const now = Date.now();
      let throttled = false;
      const bucket = forgotAttempts.get(ip);
      if (!bucket || now - bucket.windowStart > 15 * 60_000) {
        forgotAttempts.set(ip, { count: 1, windowStart: now });
      } else if (++bucket.count > 5) {
        throttled = true;
      }
      if (forgotAttempts.size > 5000) forgotAttempts.clear();

      const user = throttled ? null : await authStorage.getUserByEmail(email);
      if (user) {
        const { token, hash } = generateToken();
        await db
          .update(users)
          .set({ resetTokenHash: hash, resetTokenExpiresAt: new Date(now + 60 * 60 * 1000), updatedAt: new Date() })
          .where(eq(users.id, user.id));
        import("../../services/email/email-service")
          .then(({ sendPasswordResetEmail }) =>
            sendPasswordResetEmail(user.email, `${appBaseUrl(req)}/reset-password?token=${token}`, user.id))
          .catch((err) => console.warn("Password reset email failed:", err?.message || err));
      }
      // Always the same response — never reveal whether the email exists.
      res.json({ message: "If that email is registered, a reset link has been sent." });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid email address" });
      console.error("Forgot password error:", error);
      res.status(500).json({ message: "Failed to process request" });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = z
        .object({ token: z.string().min(10).max(200), newPassword: z.string().min(6, "Password must be at least 6 characters") })
        .parse(req.body);
      const hash = hashToken(token);
      const [user] = await db.select().from(users).where(eq(users.resetTokenHash, hash)).limit(1);
      if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
        return res.status(400).json({ message: "This reset link is invalid or has expired." });
      }
      await authStorage.updateUser(user.id, { password: newPassword });
      await db
        .update(users)
        .set({ resetTokenHash: null, resetTokenExpiresAt: null, updatedAt: new Date() })
        .where(eq(users.id, user.id));

      import("../../services/email/email-service")
        .then(({ sendSecurityAlertEmail }) =>
          sendSecurityAlertEmail(user.email, "Your password was reset using a password-reset link. If this wasn't you, contact support immediately.", user.id))
        .catch((err) => console.warn("Security alert email failed:", err?.message || err));

      res.json({ message: "Password reset successfully. You can now log in." });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0].message });
      console.error("Reset password error:", error);
      res.status(500).json({ message: "Failed to reset password" });
    }
  });

  app.post("/api/auth/change-password", isAuthenticated, async (req, res) => {
    try {
      const data = changePasswordSchema.parse(req.body);
      const user = await authStorage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const isValid = await authStorage.validatePassword(data.currentPassword, user.password);
      if (!isValid) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }

      if (data.currentPassword === data.newPassword) {
        return res.status(400).json({ message: "New password must be different from current password" });
      }

      await authStorage.updateUser(user.id, { password: data.newPassword });
      console.log(`[Auth] Password changed for user ${user.id}`);

      // Fire-and-forget security alert email.
      import("../../services/email/email-service")
        .then(({ sendSecurityAlertEmail }) =>
          sendSecurityAlertEmail(user.email, "Your account password was changed. If this wasn't you, reset your password immediately and contact support.", user.id))
        .catch((err) => console.warn("Security alert email failed:", err?.message || err));

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("Change password error:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  app.patch("/api/auth/profile", isAuthenticated, async (req, res) => {
    try {
      const data = updateProfileSchema.parse(req.body);

      if (data.email) {
        data.email = data.email.toLowerCase();
        const existing = await authStorage.getUserByEmail(data.email);
        if (existing && existing.id !== req.session.userId) {
          return res.status(400).json({ message: "Email already in use" });
        }
      }

      const user = await authStorage.updateUser(req.session.userId!, data);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const { password: _, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      console.error("Update profile error:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  app.delete("/api/auth/account", isAuthenticated, async (req, res) => {
    try {
      const { password } = req.body;
      if (!password) {
        return res.status(400).json({ message: "Password is required to delete account" });
      }

      const user = await authStorage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const isValid = await authStorage.validatePassword(password, user.password);
      if (!isValid) {
        return res.status(400).json({ message: "Incorrect password" });
      }

      const userId = user.id;
      const tablesResult = await db.execute(sql`
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'user_id'
          AND table_name != 'users'
      `);
      for (const row of tablesResult.rows) {
        const tableName = (row as any).table_name;
        await db.execute(sql.raw(`DELETE FROM "${tableName}" WHERE user_id = '${userId.replace(/'/g, "''")}'`));
      }
      await db.delete(users).where(eq(users.id, userId));
      console.log(`[Auth] Account deleted for user ${userId} (${user.email}) with all associated data`);

      req.session.destroy((err) => {
        if (err) console.error("Session destroy error after account deletion:", err);
        res.clearCookie("connect.sid");
        res.json({ message: "Account deleted successfully" });
      });
    } catch (error) {
      console.error("Delete account error:", error);
      res.status(500).json({ message: "Failed to delete account" });
    }
  });

  app.get("/api/auth/me", isAuthenticated, async (req, res) => {
    try {
      const user = await authStorage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const brokerConnection = await storage.getBrokerConnection(user.id);
      const entitlements = getUserEntitlements(user.id);

      res.json({
        user: { id: user.id, email: user.email, role: user.role },
        entitlements,
        broker: {
          connected: brokerConnection?.isConnected ?? false,
          provider: brokerConnection?.provider ?? null,
        },
      });
    } catch (error) {
      console.error("[Auth] /me lookup failed:", (error as Error).message);
      res.status(500).json({ message: "Failed to fetch user info" });
    }
  });
}
