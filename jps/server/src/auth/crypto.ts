import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { Role } from "./permissions.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET manquant (voir server/.env)");
}

export interface SessionPayload {
  sub: string; // id utilisateur
  role: Role;
  doitChangerMotDePasse: boolean;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Mot de passe temporaire lisible communiqué à la main par l'administrateur. */
export function generateTempPassword(): string {
  // ex: "7K3M-9PQR" — assez d'entropie pour un usage à usage unique, facile à recopier oralement.
  const raw = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET!, { expiresIn: "12h" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET!) as SessionPayload;
  } catch {
    return null;
  }
}
