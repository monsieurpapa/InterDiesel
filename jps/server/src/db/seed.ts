import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postgres from "postgres";
import { db, client } from "./index.js";
import { canauxPaiement, categoriesActivite, utilisateurs, entreprise } from "./schema.js";
import { generateTempPassword, hashPassword } from "../auth/crypto.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);

  const viewsSql = readFileSync(path.join(__dirname, "views.sql"), "utf-8");
  await sql.unsafe(viewsSql);
  console.log("Vues créées.");

  const canaux = [
    ["CASH", "Espèces"],
    ["MPESA", "M-Pesa"],
    ["AIRTELMONEY", "Airtel Money"],
    ["ORANGEMONEY", "Orange Money"],
    ["EQUITY", "Equity BCDC"],
    ["TMB", "Trust Merchant Bank"],
    ["RAWBANK", "Rawbank"],
    ["CADECO", "Cadeco"],
    ["VIREMENT", "Virement bancaire"],
    ["CHEQUE", "Chèque"],
    ["CARTE", "Carte bancaire"],
  ] as const;

  for (const [code, libelle] of canaux) {
    await db.insert(canauxPaiement).values({ code, libelle }).onConflictDoNothing({
      target: canauxPaiement.code,
    });
  }

  const categories = [
    ["TRANSPORT", "Transport de marchandises"],
    ["LOCATION_ENTREPOT", "Location d'entrepôt"],
    ["LOCATION_VEHICULE", "Location de véhicule"],
    ["SERVICE_DIVERS", "Fourniture de service divers"],
    ["ABONNEMENT_DISTRIBUTION", "Distribution / crédit d'abonnements"],
    ["MANUTENTION_STATIONNEMENT", "Manutention et stationnement"],
    ["COMMISSION", "Commissionnement"],
    ["AUTRE", "Autre"],
  ] as const;

  for (const [code, libelle] of categories) {
    await db.insert(categoriesActivite).values({ code, libelle }).onConflictDoNothing({
      target: categoriesActivite.code,
    });
  }

  console.log("Données de référence insérées.");

  const existingEntreprise = await db.select().from(entreprise);
  if (existingEntreprise.length === 0) {
    await db.insert(entreprise).values({
      nom: "JPS DIEU MERCI",
      adresse: "N° 122, C/MBUNYA, Q. LUMUMBA, AV DELIBERATION",
      ville: "VILLE DE BUNIA",
      telephone: "0997785896 - 0810099378",
      nImpot: "A1516146S",
      idNational: "4-93-N18362B",
      rccm: "RCCM CD/BIA/RCCM-17-A-1193",
      coordonneesBancaires: "1252-00584272701-19/CDF/RAWBANK/ETS MSO JPS DM",
      tauxTvaDefaut: "0.16",
    });
    console.log("Informations de l'entreprise insérées.");
  } else {
    console.log("Informations de l'entreprise déjà présentes — aucune insertion.");
  }

  const existingAdmins = await db.select().from(utilisateurs);
  if (existingAdmins.length === 0) {
    const tempPassword = generateTempPassword();
    const motDePasseHash = await hashPassword(tempPassword);
    await db.insert(utilisateurs).values({
      nom: "Administrateur",
      email: "admin@jps.local",
      motDePasseHash,
      role: "ADMIN",
      doitChangerMotDePasse: true,
    });
    console.log("\n=== Compte administrateur initial créé ===");
    console.log("Email :", "admin@jps.local");
    console.log("Mot de passe temporaire :", tempPassword);
    console.log("(changement obligatoire à la première connexion)\n");
  } else {
    console.log("Utilisateurs déjà présents — aucun compte administrateur créé.");
  }

  await sql.end();
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
