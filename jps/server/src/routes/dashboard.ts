import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

export const dashboardRouter = Router();

dashboardRouter.get("/synthese-journaliere", async (_req, res) => {
  const rows = await db.execute(sql`select * from v_synthese_journaliere order by date_mouvement desc`);
  res.json(rows);
});

dashboardRouter.get("/solde-stock-distribution", async (_req, res) => {
  const rows = await db.execute(sql`select * from v_solde_stock_distribution`);
  res.json(rows[0] ?? { stock_actuel: 0 });
});

dashboardRouter.get("/chiffre-affaires-mensuel", async (_req, res) => {
  const rows = await db.execute(sql`select * from v_chiffre_affaires_mensuel order by mois desc`);
  res.json(rows);
});
