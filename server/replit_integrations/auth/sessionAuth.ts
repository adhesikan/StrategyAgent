import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    partnerUserId?: string;
    partnerSlug?: string;
    tradierOAuthState?: string;
    tradierOAuthUserId?: string;
    tradestationOAuthState?: string;
    tradestationOAuthUserId?: string;
    tradestationOAuthFromPartner?: boolean;
  }
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  
  const isProduction = process.env.NODE_ENV === "production";
  
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      maxAge: sessionTtl,
      sameSite: isProduction ? "none" : "lax",
    },
  });
}

export async function setupAuth(app: Express) {
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }
  app.use(getSession());
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (req.session.partnerUserId) {
    return res.status(403).json({ message: "Partner accounts cannot access the full platform. Use /api/partner/* endpoints." });
  }
  next();
};

export const isAuthenticatedOrPartner: RequestHandler = async (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
};
