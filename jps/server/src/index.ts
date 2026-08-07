import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { crudRouter } from "./routes/crud.js";
import { facturesRouter } from "./routes/factures.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { entrepriseRouter } from "./routes/entreprise.js";
import { authRouter } from "./routes/auth.js";
import { utilisateursRouter } from "./routes/utilisateurs.js";
import { requireAuth, requirePasswordAlreadyChanged, requireModule, requireAdmin } from "./auth/middleware.js";
import type { Module } from "./auth/permissions.js";
import {
  clients,
  services,
  tarifsTransport,
  contratsLocation,
  vehicules,
  distributeurs,
  encaissements,
  facturesARembourser,
  operationsDistribution,
  employes,
  depensesPersonnel,
  depensesFonctionnement,
  mouvementsCaisse,
  canauxPaiement,
  categoriesActivite,
} from "./db/schema.js";

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);

/** Chaque route métier exige une session valide, un mot de passe déjà changé,
 * et le niveau d'accès requis pour son module (lecture pour GET, écriture sinon). */
function protect(mod: Module) {
  return [requireAuth, requirePasswordAlreadyChanged, requireModule(mod)];
}

app.use("/api/clients", ...protect("facturation"), crudRouter(clients));
app.use("/api/services", ...protect("facturation"), crudRouter(services));
app.use("/api/tarifs-transport", ...protect("transport"), crudRouter(tarifsTransport));
app.use("/api/contrats-location", ...protect("locations"), crudRouter(contratsLocation));
app.use("/api/vehicules", ...protect("locations"), crudRouter(vehicules));
app.use("/api/distributeurs", ...protect("distribution"), crudRouter(distributeurs));
app.use("/api/encaissements", ...protect("facturation"), crudRouter(encaissements));
app.use("/api/factures-a-rembourser", ...protect("facturation"), crudRouter(facturesARembourser));
app.use("/api/operations-distribution", ...protect("distribution"), crudRouter(operationsDistribution));
app.use("/api/employes", ...protect("personnel"), crudRouter(employes));
app.use("/api/depenses-personnel", ...protect("personnel"), crudRouter(depensesPersonnel));
app.use("/api/depenses-fonctionnement", ...protect("personnel"), crudRouter(depensesFonctionnement));
app.use("/api/mouvements-caisse", ...protect("tresorerie"), crudRouter(mouvementsCaisse));
app.use("/api/canaux-paiement", ...protect("referentiel"), crudRouter(canauxPaiement));
app.use("/api/categories-activite", ...protect("referentiel"), crudRouter(categoriesActivite));

app.use("/api/factures", ...protect("facturation"), facturesRouter);
app.use("/api/dashboard", requireAuth, requirePasswordAlreadyChanged, dashboardRouter);
app.use("/api/entreprise", requireAuth, requirePasswordAlreadyChanged, entrepriseRouter);
app.use("/api/utilisateurs", requireAuth, requirePasswordAlreadyChanged, requireAdmin, utilisateursRouter);

// Sert le client React compilé (même origine que l'API — évite les soucis de
// cookie/CORS cross-domaine pour la session). Absent en développement local,
// où le client tourne séparément sur le serveur Vite avec son propre proxy.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, "../../client/dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`API JPS Dieu Merci en écoute sur http://localhost:${port}`);
});
