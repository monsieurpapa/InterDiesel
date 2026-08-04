import { Router } from "express";
import rateLimit from "express-rate-limit";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { utilisateurs } from "../db/schema.js";
import { hashPassword, signSession, verifyPassword } from "../auth/crypto.js";
import { COOKIE_NAME, requireAuth } from "../auth/middleware.js";
import { ROLE_LABELS } from "../auth/permissions.js";
import type { Role } from "../auth/permissions.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "TROP_DE_TENTATIVES" },
});

const isProd = process.env.NODE_ENV === "production";

function setSessionCookie(res: import("express").Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 12 * 60 * 60 * 1000,
  });
}

function publicUser(row: typeof utilisateurs.$inferSelect) {
  return {
    id: row.id,
    nom: row.nom,
    email: row.email,
    role: row.role as Role,
    roleLabel: ROLE_LABELS[row.role as Role],
    doitChangerMotDePasse: row.doitChangerMotDePasse,
  };
}

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    return res.status(400).json({ error: "IDENTIFIANTS_MANQUANTS" });
  }

  const [row] = await db
    .select()
    .from(utilisateurs)
    .where(eq(utilisateurs.email, email.trim().toLowerCase()));

  if (!row || !row.actif) {
    return res.status(401).json({ error: "IDENTIFIANTS_INVALIDES" });
  }

  const valid = await verifyPassword(password, row.motDePasseHash);
  if (!valid) {
    return res.status(401).json({ error: "IDENTIFIANTS_INVALIDES" });
  }

  await db
    .update(utilisateurs)
    .set({ derniereConnexionLe: new Date() })
    .where(eq(utilisateurs.id, row.id));

  const token = signSession({
    sub: row.id,
    role: row.role as Role,
    doitChangerMotDePasse: row.doitChangerMotDePasse,
  });
  setSessionCookie(res, token);
  res.json({ user: publicUser(row) });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.status(204).end();
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const [row] = await db.select().from(utilisateurs).where(eq(utilisateurs.id, req.user!.id));
  if (!row) return res.status(401).json({ error: "NON_AUTHENTIFIE" });
  res.json({ user: publicUser(row) });
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "CHAMPS_MANQUANTS" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "MOT_DE_PASSE_TROP_COURT" });
  }

  const [row] = await db.select().from(utilisateurs).where(eq(utilisateurs.id, req.user!.id));
  if (!row) return res.status(401).json({ error: "NON_AUTHENTIFIE" });

  const valid = await verifyPassword(currentPassword, row.motDePasseHash);
  if (!valid) {
    return res.status(401).json({ error: "MOT_DE_PASSE_ACTUEL_INCORRECT" });
  }

  const motDePasseHash = await hashPassword(newPassword);
  await db
    .update(utilisateurs)
    .set({ motDePasseHash, doitChangerMotDePasse: false })
    .where(eq(utilisateurs.id, row.id));

  const token = signSession({ sub: row.id, role: row.role as Role, doitChangerMotDePasse: false });
  setSessionCookie(res, token);
  res.json({ ok: true });
});
