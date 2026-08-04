import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db, client } from "./index.js";
import {
  clients,
  services,
  tarifsTransport,
  distributeurs,
  employes,
  operationsDistribution,
  facturesARembourser,
  factures,
  lignesFacture,
  canauxPaiement,
  categoriesActivite,
} from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "legacy-data");

function load<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(DATA_DIR, name), "utf-8"));
}

// Classification manuelle des 32 services réels — trop peu nombreux pour
// justifier une heuristique par mot-clé fragile.
const SERVICE_CATEGORIE: Record<string, string> = {
  P0001: "TRANSPORT", P0002: "TRANSPORT", P0003: "TRANSPORT", P0004: "TRANSPORT",
  P0005: "TRANSPORT", P0006: "TRANSPORT", P0007: "TRANSPORT",
  P0008: "SERVICE_DIVERS", P0009: "LOCATION_ENTREPOT",
  P0010: "ABONNEMENT_DISTRIBUTION", P0011: "ABONNEMENT_DISTRIBUTION", P0012: "ABONNEMENT_DISTRIBUTION",
  P0013: "MANUTENTION_STATIONNEMENT", P0014: "MANUTENTION_STATIONNEMENT",
  P0015: "TRANSPORT", P0016: "TRANSPORT", P0017: "TRANSPORT", P0018: "TRANSPORT", P0019: "TRANSPORT",
  P0020: "SERVICE_DIVERS", P0021: "LOCATION_ENTREPOT", P0022: "TRANSPORT",
  P0023: "COMMISSION", P0024: "TRANSPORT", P0025: "TRANSPORT",
  P0026: "SERVICE_DIVERS", P0027: "SERVICE_DIVERS", P0028: "SERVICE_DIVERS",
  P0029: "SERVICE_DIVERS", P0030: "COMMISSION", P0031: "TRANSPORT", P0032: "TRANSPORT",
};

interface ClientRow {
  code: string; type: string | null; nom: string; adresse: string | null;
  nImpot: string | null; ville: string | null; telephone: string | null;
  idNational: string | null; rccm: string | null; email: string | null; remarques: string | null;
}
interface ServiceRow {
  reference: string; description: string; prixUnitaire: number; tauxTva: number; coutAchat: number;
}
interface TarifRow { villeArrivee: string; prixForfait100: number }
interface DistributeurRow { numeroDist: number; nomPointVente: string; ville: string | null }
interface OperationRow {
  dateOperation: string; numeroDist: number; description: string; canalCode: string;
  montantCreditation: number; montantApprovisionnement: number; statut: string;
  typeOperation: string; responsable: string | null;
}
interface RemboursementRow {
  dateFacture: string | null; dateEnvoi: string | null; natureOperation: string;
  numeroFactureExterne: string | null; numeroBdc: string | null; montant: number;
  devise: string; statut: string;
}
interface FactureRow {
  numero: string; type: string; clientCode: string; dateFacture: string;
  moyenReglementCode: string | null; remisePct: number; devise: string;
  lignes: { serviceReference: string; quantite: number }[];
}

async function main() {
  console.log("=== Import des données historiques JPS DIEU MERCI ===\n");

  // ---- Référentiels déjà seedés : canaux de paiement ----
  const canaux = await db.select().from(canauxPaiement);
  const canalIdByCode = new Map(canaux.map((c) => [c.code, c.id]));

  // ---- 1. Clients ----
  const clientRows = load<ClientRow[]>("clients.json");
  const clientIdByCode = new Map<string, string>();
  for (const c of clientRows) {
    const [row] = await db
      .insert(clients)
      .values({
        code: c.code,
        type: c.type,
        nom: c.nom,
        adresse: c.adresse,
        ville: c.ville,
        telephone: c.telephone,
        nImpot: c.nImpot,
        idNational: c.idNational,
        rccm: c.rccm,
        email: c.email,
        remarques: c.remarques,
      })
      .onConflictDoNothing({ target: clients.code })
      .returning();
    if (row) clientIdByCode.set(c.code, row.id);
    else {
      const [existing] = await db.select().from(clients).where(eq(clients.code, c.code));
      if (existing) clientIdByCode.set(c.code, existing.id);
    }
  }
  console.log(`Clients : ${clientIdByCode.size} importés`);

  // ---- 2. Services ----
  const serviceRows = load<ServiceRow[]>("services.json");
  const categories = await db.select().from(categoriesActivite);
  const categorieIdByCode = new Map(categories.map((c) => [c.code, c.id]));
  const serviceIdByRef = new Map<string, string>();
  for (const s of serviceRows) {
    const categorieCode = SERVICE_CATEGORIE[s.reference] ?? "AUTRE";
    const categorieId = categorieIdByCode.get(categorieCode);
    const [row] = await db
      .insert(services)
      .values({
        reference: s.reference,
        categorieId: categorieId!,
        description: s.description,
        prixUnitaire: String(s.prixUnitaire),
        devise: "CDF",
        tauxTva: String(s.tauxTva),
        coutAchat: String(s.coutAchat),
      })
      .onConflictDoNothing({ target: services.reference })
      .returning();
    if (row) serviceIdByRef.set(s.reference, row.id);
    else {
      const [existing] = await db.select().from(services).where(eq(services.reference, s.reference));
      if (existing) serviceIdByRef.set(s.reference, existing.id);
    }
  }
  console.log(`Services : ${serviceIdByRef.size} importés`);

  // ---- 3. Tarifs transport ----
  const tarifRows = load<TarifRow[]>("tarifs_transport.json");
  let tarifCount = 0;
  for (const t of tarifRows) {
    const [row] = await db
      .insert(tarifsTransport)
      .values({ villeArrivee: t.villeArrivee, prixForfait100: String(t.prixForfait100) })
      .onConflictDoNothing({ target: [tarifsTransport.villeDepart, tarifsTransport.villeArrivee] })
      .returning();
    if (row) tarifCount++;
  }
  console.log(`Tarifs transport : ${tarifCount} importés`);

  // ---- 4. Distributeurs ----
  const distRows = load<DistributeurRow[]>("distributeurs.json");
  const distIdByNumero = new Map<number, string>();
  for (const d of distRows) {
    const [row] = await db
      .insert(distributeurs)
      .values({ numeroDist: d.numeroDist, nomPointVente: d.nomPointVente, ville: d.ville })
      .onConflictDoNothing({ target: distributeurs.numeroDist })
      .returning();
    if (row) distIdByNumero.set(d.numeroDist, row.id);
    else {
      const [existing] = await db.select().from(distributeurs).where(eq(distributeurs.numeroDist, d.numeroDist));
      if (existing) distIdByNumero.set(d.numeroDist, existing.id);
    }
  }
  console.log(`Distributeurs : ${distIdByNumero.size} importés`);

  // ---- 5. Employés (déduits des responsables du journal) ----
  const employeIdByNom = new Map<string, string>();
  for (const nom of ["JULIENNE", "JPS"]) {
    const existing = await db.select().from(employes).where(eq(employes.nom, nom));
    if (existing.length) {
      employeIdByNom.set(nom, existing[0].id);
    } else {
      const [row] = await db.insert(employes).values({ nom }).returning();
      employeIdByNom.set(nom, row.id);
    }
  }
  console.log(`Employés : ${employeIdByNom.size} (créés si absents)`);

  // ---- 6. Opérations de distribution ----
  const opRows = load<OperationRow[]>("operations_distribution.json");
  const existingOps = await db.select({ id: operationsDistribution.id }).from(operationsDistribution);
  let opCount = 0;
  if (existingOps.length === 0) {
    for (const o of opRows) {
      const canalId = canalIdByCode.get(o.canalCode);
      if (!canalId) {
        console.warn(`  canal inconnu ignoré: ${o.canalCode} (ligne ${o.dateOperation}/${o.numeroDist})`);
        continue;
      }
      await db.insert(operationsDistribution).values({
        dateOperation: o.dateOperation,
        distributeurId: distIdByNumero.get(o.numeroDist) ?? null,
        typeOperation: o.typeOperation as any,
        description: o.description,
        canalPaiementId: canalId,
        montantCreditation: String(o.montantCreditation),
        montantApprovisionnement: String(o.montantApprovisionnement),
        statut: o.statut as any,
        responsableId: o.responsable ? employeIdByNom.get(o.responsable) ?? null : null,
        devise: "CDF",
      });
      opCount++;
    }
  } else {
    console.log("  (déjà présentes — import ignoré, table non vide)");
  }
  console.log(`Opérations de distribution : ${opCount} importées`);

  // ---- 7. Factures à rembourser ----
  const rembRows = load<RemboursementRow[]>("factures_a_rembourser.json");
  const existingRemb = await db.select({ id: facturesARembourser.id }).from(facturesARembourser);
  let rembCount = 0;
  if (existingRemb.length === 0) {
    for (const r of rembRows) {
      await db.insert(facturesARembourser).values({
        dateFacture: r.dateFacture,
        dateEnvoi: r.dateEnvoi,
        natureOperation: r.natureOperation,
        numeroFactureExterne: r.numeroFactureExterne,
        numeroBdc: r.numeroBdc,
        montant: String(r.montant),
        devise: r.devise as any,
        statut: r.statut as any,
      });
      rembCount++;
    }
  } else {
    console.log("  (déjà présentes — import ignoré, table non vide)");
  }
  console.log(`Factures à rembourser : ${rembCount} importées`);

  // ---- 8. Factures + lignes ----
  const factureRows = load<FactureRow[]>("factures.json");
  let factureCount = 0;
  let ligneCount = 0;
  for (const f of factureRows) {
    const clientId = clientIdByCode.get(f.clientCode);
    if (!clientId) {
      console.warn(`  client inconnu ignoré pour facture ${f.numero}: ${f.clientCode}`);
      continue;
    }
    const [factureRow] = await db
      .insert(factures)
      .values({
        numero: f.numero,
        type: f.type as any,
        clientId,
        dateFacture: f.dateFacture,
        moyenReglementId: f.moyenReglementCode ? canalIdByCode.get(f.moyenReglementCode) ?? null : null,
        remisePct: String(f.remisePct),
        devise: f.devise as any,
        statut: "EMISE",
      })
      .onConflictDoNothing({ target: factures.numero })
      .returning();
    if (!factureRow) continue;
    factureCount++;
    for (const l of f.lignes) {
      const serviceId = serviceIdByRef.get(l.serviceReference);
      const service = serviceRows.find((s) => s.reference === l.serviceReference);
      if (!serviceId || !service) continue;
      await db.insert(lignesFacture).values({
        factureId: factureRow.id,
        serviceId,
        description: service.description,
        quantite: String(l.quantite),
        prixUnitaire: String(service.prixUnitaire),
        tauxTva: String(service.tauxTva),
      });
      ligneCount++;
    }
  }
  console.log(`Factures : ${factureCount} importées (${ligneCount} lignes)`);

  console.log("\n=== Import terminé ===");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
