import { Router } from "express";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../db/index.js";
import { utilisateurs } from "../db/schema.js";
import { generateTempPassword, hashPassword } from "../auth/crypto.js";
import { ROLES, ROLE_LABELS } from "../auth/permissions.js";
import type { Role } from "../auth/permissions.js";

export const utilisateursRouter = Router();

function publicUser(row: typeof utilisateurs.$inferSelect) {
  return {
    id: row.id,
    nom: row.nom,
    email: row.email,
    role: row.role as Role,
    roleLabel: ROLE_LABELS[row.role as Role],
    actif: row.actif,
    doitChangerMotDePasse: row.doitChangerMotDePasse,
    creeLe: row.creeLe,
    derniereConnexionLe: row.derniereConnexionLe,
  };
}

async function countOtherActiveAdmins(excludeId: string): Promise<number> {
  const rows = await db
    .select()
    .from(utilisateurs)
    .where(and(eq(utilisateurs.role, "ADMIN"), eq(utilisateurs.actif, true), ne(utilisateurs.id, excludeId)));
  return rows.length;
}

utilisateursRouter.get("/", async (_req, res) => {
  const rows = await db.select().from(utilisateurs);
  res.json(rows.map(publicUser));
});

utilisateursRouter.post("/", async (req, res) => {
  const { nom, email, role } = req.body as { nom?: string; email?: string; role?: Role };
  if (!nom || !email || !role || !ROLES.includes(role)) {
    return res.status(400).json({ error: "CHAMPS_INVALIDES" });
  }

  const tempPassword = generateTempPassword();
  const motDePasseHash = await hashPassword(tempPassword);

  try {
    const [row] = await db
      .insert(utilisateurs)
      .values({ nom, email: email.trim().toLowerCase(), role, motDePasseHash })
      .returning();
    res.status(201).json({ ...publicUser(row), tempPassword });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

utilisateursRouter.put("/:id", async (req, res) => {
  const { nom, role, actif } = req.body as { nom?: string; role?: Role; actif?: boolean };
  if (role && !ROLES.includes(role)) {
    return res.status(400).json({ error: "ROLE_INVALIDE" });
  }

  const [existing] = await db.select().from(utilisateurs).where(eq(utilisateurs.id, req.params.id));
  if (!existing) return res.status(404).json({ error: "INTROUVABLE" });

  const losesAdmin = existing.role === "ADMIN" && ((role && role !== "ADMIN") || actif === false);
  if (losesAdmin && (await countOtherActiveAdmins(existing.id)) === 0) {
    return res.status(400).json({ error: "DERNIER_ADMINISTRATEUR" });
  }

  try {
    const [row] = await db
      .update(utilisateurs)
      .set({
        ...(nom !== undefined ? { nom } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(actif !== undefined ? { actif } : {}),
      })
      .where(eq(utilisateurs.id, req.params.id))
      .returning();
    res.json(publicUser(row));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

utilisateursRouter.post("/:id/reset-password", async (req, res) => {
  const [existing] = await db.select().from(utilisateurs).where(eq(utilisateurs.id, req.params.id));
  if (!existing) return res.status(404).json({ error: "INTROUVABLE" });

  const tempPassword = generateTempPassword();
  const motDePasseHash = await hashPassword(tempPassword);
  const [row] = await db
    .update(utilisateurs)
    .set({ motDePasseHash, doitChangerMotDePasse: true })
    .where(eq(utilisateurs.id, req.params.id))
    .returning();
  res.json({ ...publicUser(row), tempPassword });
});

utilisateursRouter.delete("/:id", async (req, res) => {
  const [existing] = await db.select().from(utilisateurs).where(eq(utilisateurs.id, req.params.id));
  if (!existing) return res.status(404).json({ error: "INTROUVABLE" });

  if (existing.role === "ADMIN" && (await countOtherActiveAdmins(existing.id)) === 0) {
    return res.status(400).json({ error: "DERNIER_ADMINISTRATEUR" });
  }

  await db.delete(utilisateurs).where(eq(utilisateurs.id, req.params.id));
  res.status(204).end();
});
