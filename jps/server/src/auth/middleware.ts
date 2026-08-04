import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { utilisateurs } from "../db/schema.js";
import { verifySession } from "./crypto.js";
import { hasAccess, type Module } from "./permissions.js";
import type { Role } from "./permissions.js";

export interface AuthUser {
  id: string;
  nom: string;
  email: string;
  role: Role;
  doitChangerMotDePasse: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const COOKIE_NAME = "jps_session";
export { COOKIE_NAME };

/** Vérifie le cookie de session et recharge l'utilisateur depuis la base
 * (et non seulement le JWT) pour refléter immédiatement une désactivation
 * de compte ou un changement de rôle décidé par un administrateur. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME];
  const payload = token ? verifySession(token) : null;
  if (!payload) {
    return res.status(401).json({ error: "NON_AUTHENTIFIE" });
  }

  const [row] = await db.select().from(utilisateurs).where(eq(utilisateurs.id, payload.sub));
  if (!row || !row.actif) {
    return res.status(401).json({ error: "NON_AUTHENTIFIE" });
  }

  req.user = {
    id: row.id,
    nom: row.nom,
    email: row.email,
    role: row.role as Role,
    doitChangerMotDePasse: row.doitChangerMotDePasse,
  };
  next();
}

/** Bloque tout accès métier tant que le mot de passe temporaire n'a pas été changé. */
export function requirePasswordAlreadyChanged(req: Request, res: Response, next: NextFunction) {
  if (req.user?.doitChangerMotDePasse) {
    return res.status(403).json({ error: "MOT_DE_PASSE_A_CHANGER" });
  }
  next();
}

export function requireModule(mod: Module) {
  return (req: Request, res: Response, next: NextFunction) => {
    const needed = req.method === "GET" ? "read" : "write";
    if (!req.user || !hasAccess(req.user.role, mod, needed)) {
      return res.status(403).json({ error: "ACCES_REFUSE" });
    }
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "ACCES_REFUSE" });
  }
  next();
}
