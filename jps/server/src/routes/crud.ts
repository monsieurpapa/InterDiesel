import { Router } from "express";
import { eq, type AnyColumn } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "../db/index.js";

/**
 * Routeur CRUD générique pour une table Drizzle qui possède une colonne `id`.
 * Couvre les opérations identiques répétées sur les ~14 tables de référentiel/saisie
 * (clients, services, employés, dépenses...) sans dupliquer le même code partout.
 */
export function crudRouter<T extends PgTable & { id: AnyColumn }>(table: T) {
  const router = Router();

  router.get("/", async (_req, res) => {
    const rows = await db.select().from(table as any);
    res.json(rows);
  });

  router.get("/:id", async (req, res) => {
    const [row] = await db
      .select()
      .from(table as any)
      .where(eq(table.id, req.params.id));
    if (!row) return res.status(404).json({ error: "Introuvable" });
    res.json(row);
  });

  router.post("/", async (req, res) => {
    try {
      const [row] = await db.insert(table as any).values(req.body).returning();
      res.status(201).json(row);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.put("/:id", async (req, res) => {
    try {
      const [row] = await db
        .update(table as any)
        .set(req.body)
        .where(eq(table.id, req.params.id))
        .returning();
      if (!row) return res.status(404).json({ error: "Introuvable" });
      res.json(row);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete("/:id", async (req, res) => {
    const [row] = await db
      .delete(table as any)
      .where(eq(table.id, req.params.id))
      .returning();
    if (!row) return res.status(404).json({ error: "Introuvable" });
    res.status(204).end();
  });

  return router;
}
