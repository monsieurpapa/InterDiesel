import { Router } from "express";
import { db } from "../db/index.js";
import { entreprise } from "../db/schema.js";

export const entrepriseRouter = Router();

// Informations de l'entreprise (en-tête des factures imprimées) — lecture
// seule ici ; une seule ligne existe, gérée par le seed.
entrepriseRouter.get("/", async (_req, res) => {
  const [row] = await db.select().from(entreprise);
  res.json(row ?? null);
});
