import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { factures, lignesFacture, encaissements, clients } from "../db/schema.js";

export const facturesRouter = Router();

facturesRouter.get("/", async (_req, res) => {
  const rows = await db.select().from(factures);
  res.json(rows);
});

facturesRouter.get("/:id", async (req, res) => {
  const [facture] = await db.select().from(factures).where(eq(factures.id, req.params.id));
  if (!facture) return res.status(404).json({ error: "Introuvable" });
  const [client] = await db.select().from(clients).where(eq(clients.id, facture.clientId));
  const lignes = await db
    .select()
    .from(lignesFacture)
    .where(eq(lignesFacture.factureId, req.params.id));
  const paiements = await db
    .select()
    .from(encaissements)
    .where(eq(encaissements.factureId, req.params.id));
  res.json({ ...facture, client, lignes, paiements });
});

// Crée une facture avec ses lignes en une seule requête (formulaire du front).
facturesRouter.post("/", async (req, res) => {
  const { lignes, ...factureData } = req.body as {
    lignes?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  try {
    const [facture] = await db.insert(factures).values(factureData as any).returning();
    let insertedLignes: unknown[] = [];
    if (lignes?.length) {
      insertedLignes = await db
        .insert(lignesFacture)
        .values(lignes.map((l) => ({ ...l, factureId: facture.id })) as any)
        .returning();
    }
    res.status(201).json({ ...facture, lignes: insertedLignes });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

facturesRouter.put("/:id", async (req, res) => {
  const { lignes, ...factureData } = req.body as {
    lignes?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  try {
    const [facture] = await db
      .update(factures)
      .set(factureData as any)
      .where(eq(factures.id, req.params.id))
      .returning();
    if (!facture) return res.status(404).json({ error: "Introuvable" });

    if (lignes) {
      await db.delete(lignesFacture).where(eq(lignesFacture.factureId, req.params.id));
      if (lignes.length) {
        await db
          .insert(lignesFacture)
          .values(lignes.map((l) => ({ ...l, factureId: facture.id })) as any);
      }
    }
    res.json(facture);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

facturesRouter.delete("/:id", async (req, res) => {
  const [row] = await db.delete(factures).where(eq(factures.id, req.params.id)).returning();
  if (!row) return res.status(404).json({ error: "Introuvable" });
  res.status(204).end();
});
