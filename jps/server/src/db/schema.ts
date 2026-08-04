import {
  pgTable,
  uuid,
  text,
  smallint,
  bigint,
  numeric,
  boolean,
  date,
  timestamp,
  check,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ----------------------------------------------------------------------------
// 0. ENTREPRISE
// ----------------------------------------------------------------------------
export const entreprise = pgTable("entreprise", {
  id: uuid("id").primaryKey().defaultRandom(),
  nom: text("nom").notNull(),
  adresse: text("adresse"),
  ville: text("ville"),
  telephone: text("telephone"),
  nImpot: text("n_impot"),
  idNational: text("id_national"),
  rccm: text("rccm"),
  coordonneesBancaires: text("coordonnees_bancaires"),
  tauxTvaDefaut: numeric("taux_tva_defaut", { precision: 5, scale: 4 })
    .notNull()
    .default("0.16"),
});

// ----------------------------------------------------------------------------
// 0.5 UTILISATEURS & AUTHENTIFICATION
// ----------------------------------------------------------------------------
export const utilisateurs = pgTable(
  "utilisateurs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nom: text("nom").notNull(),
    email: text("email").notNull().unique(),
    motDePasseHash: text("mot_de_passe_hash").notNull(),
    role: text("role").notNull(),
    actif: boolean("actif").notNull().default(true),
    doitChangerMotDePasse: boolean("doit_changer_mot_de_passe").notNull().default(true),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
    derniereConnexionLe: timestamp("derniere_connexion_le", { withTimezone: true }),
  },
  (t) => [
    check(
      "utilisateurs_role_check",
      sql`${t.role} in ('ADMIN','GESTIONNAIRE','COMPTABLE','CAISSIER','LECTURE_SEULE')`,
    ),
  ],
);

// ----------------------------------------------------------------------------
// 1. REFERENTIELS
// ----------------------------------------------------------------------------
export const canauxPaiement = pgTable("canaux_paiement", {
  id: smallint("id").primaryKey().generatedAlwaysAsIdentity(),
  code: text("code").notNull().unique(),
  libelle: text("libelle").notNull(),
});

export const categoriesActivite = pgTable("categories_activite", {
  id: smallint("id").primaryKey().generatedAlwaysAsIdentity(),
  code: text("code").notNull().unique(),
  libelle: text("libelle").notNull(),
});

export const employes = pgTable("employes", {
  id: uuid("id").primaryKey().defaultRandom(),
  nom: text("nom").notNull(),
  poste: text("poste"),
  villeAffectation: text("ville_affectation"),
  telephone: text("telephone"),
  dateEmbauche: date("date_embauche"),
  actif: boolean("actif").notNull().default(true),
});

// ----------------------------------------------------------------------------
// 2. TIERS
// ----------------------------------------------------------------------------
export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").unique(),
  type: text("type"),
  nom: text("nom").notNull(),
  adresse: text("adresse"),
  ville: text("ville"),
  telephone: text("telephone"),
  email: text("email"),
  nImpot: text("n_impot"),
  idNational: text("id_national"),
  rccm: text("rccm"),
  remarques: text("remarques"),
  creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
});

export const distributeurs = pgTable(
  "distributeurs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    numeroDist: bigint("numero_dist", { mode: "number" }).notNull().unique(),
    nomPointVente: text("nom_point_vente").notNull(),
    ville: text("ville"),
    statutDefaut: text("statut_defaut").notNull().default("COMPTANT"),
    canalPaiementId: smallint("canal_paiement_id").references(
      () => canauxPaiement.id,
    ),
    actif: boolean("actif").notNull().default(true),
  },
  (t) => [
    check("distributeurs_statut_defaut_check", sql`${t.statutDefaut} in ('COMPTANT','CREDIT')`),
  ],
);

// ----------------------------------------------------------------------------
// 3. CATALOGUE & TARIFICATION
// ----------------------------------------------------------------------------
export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: text("reference").unique(),
    categorieId: smallint("categorie_id")
      .notNull()
      .references(() => categoriesActivite.id),
    description: text("description").notNull(),
    prixUnitaire: numeric("prix_unitaire", { precision: 18, scale: 2 }),
    devise: text("devise").notNull().default("CDF"),
    tauxTva: numeric("taux_tva", { precision: 5, scale: 4 }).notNull().default("0"),
    coutAchat: numeric("cout_achat", { precision: 18, scale: 2 }).default("0"),
    actif: boolean("actif").notNull().default(true),
  },
  (t) => [check("services_devise_check", sql`${t.devise} in ('CDF','USD')`)],
);

export const tarifsTransport = pgTable(
  "tarifs_transport",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    villeDepart: text("ville_depart").notNull().default("BUNIA"),
    villeArrivee: text("ville_arrivee").notNull(),
    prixForfait100: numeric("prix_forfait_100", { precision: 18, scale: 2 }).notNull(),
    prixForfait50: numeric("prix_forfait_50", { precision: 18, scale: 2 }).generatedAlwaysAs(
      (): any => sql`(prix_forfait_100 / 2)`,
    ),
    prixParKg: numeric("prix_par_kg", { precision: 18, scale: 2 }),
    devise: text("devise").notNull().default("CDF"),
    actif: boolean("actif").notNull().default(true),
  },
  (t) => [
    check("tarifs_transport_devise_check", sql`${t.devise} in ('CDF','USD')`),
    unique("tarifs_transport_trajet_unique").on(t.villeDepart, t.villeArrivee),
  ],
);

// ----------------------------------------------------------------------------
// 4. CONTRATS DE LOCATION
// ----------------------------------------------------------------------------
export const vehicules = pgTable(
  "vehicules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    immatriculation: text("immatriculation").unique(),
    typeVehicule: text("type_vehicule"),
    proprietaire: text("proprietaire").notNull().default("JPS"),
    actif: boolean("actif").notNull().default(true),
  },
  (t) => [
    check("vehicules_proprietaire_check", sql`${t.proprietaire} in ('JPS','TIERS')`),
  ],
);

export const contratsLocation = pgTable(
  "contrats_location",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    vehiculeId: uuid("vehicule_id").references(() => vehicules.id),
    objet: text("objet").notNull(),
    ville: text("ville"),
    dateDebut: date("date_debut").notNull(),
    dateFin: date("date_fin"),
    montantPeriodique: numeric("montant_periodique", { precision: 18, scale: 2 }).notNull(),
    periodicite: text("periodicite").notNull().default("MENSUEL"),
    devise: text("devise").notNull().default("USD"),
    statut: text("statut").notNull().default("ACTIF"),
  },
  (t) => [
    check("contrats_location_type_check", sql`${t.type} in ('ENTREPOT','VEHICULE')`),
    check(
      "contrats_location_periodicite_check",
      sql`${t.periodicite} in ('MENSUEL','TRIMESTRIEL','ANNUEL','FORFAIT_UNIQUE')`,
    ),
    check("contrats_location_devise_check", sql`${t.devise} in ('CDF','USD')`),
    check("contrats_location_statut_check", sql`${t.statut} in ('ACTIF','TERMINE','RESILIE')`),
  ],
);

// ----------------------------------------------------------------------------
// 5. FACTURATION
// ----------------------------------------------------------------------------
export const factures = pgTable(
  "factures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    numero: text("numero").notNull().unique(),
    type: text("type").notNull().default("FACTURE"),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    dateFacture: date("date_facture").notNull(),
    dateEcheance: date("date_echeance"),
    moyenReglementId: smallint("moyen_reglement_id").references(() => canauxPaiement.id),
    remisePct: numeric("remise_pct", { precision: 5, scale: 4 }).notNull().default("0"),
    devise: text("devise").notNull().default("CDF"),
    statut: text("statut").notNull().default("BROUILLON"),
    creeLe: timestamp("cree_le", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("factures_type_check", sql`${t.type} in ('FACTURE','PROFORMA')`),
    check("factures_devise_check", sql`${t.devise} in ('CDF','USD')`),
    check(
      "factures_statut_check",
      sql`${t.statut} in ('BROUILLON','EMISE','PAYEE','PARTIELLEMENT_PAYEE','ANNULEE')`,
    ),
  ],
);

export const lignesFacture = pgTable("lignes_facture", {
  id: uuid("id").primaryKey().defaultRandom(),
  factureId: uuid("facture_id")
    .notNull()
    .references(() => factures.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").references(() => services.id),
  tarifTransportId: uuid("tarif_transport_id").references(() => tarifsTransport.id),
  description: text("description").notNull(),
  quantite: numeric("quantite", { precision: 18, scale: 3 }).notNull().default("1"),
  prixUnitaire: numeric("prix_unitaire", { precision: 18, scale: 2 }).notNull(),
  tauxTva: numeric("taux_tva", { precision: 5, scale: 4 }).notNull().default("0"),
  montantHt: numeric("montant_ht", { precision: 18, scale: 2 }).generatedAlwaysAs(
    (): any => sql`(quantite * prix_unitaire)`,
  ),
});

export const encaissements = pgTable(
  "encaissements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    factureId: uuid("facture_id")
      .notNull()
      .references(() => factures.id),
    dateEncaissement: date("date_encaissement").notNull(),
    montant: numeric("montant", { precision: 18, scale: 2 }).notNull(),
    devise: text("devise").notNull(),
    canalPaiementId: smallint("canal_paiement_id").references(() => canauxPaiement.id),
    referencePaiement: text("reference_paiement"),
  },
  (t) => [check("encaissements_devise_check", sql`${t.devise} in ('CDF','USD')`)],
);

// ----------------------------------------------------------------------------
// 6. FACTURES A REMBOURSER
// ----------------------------------------------------------------------------
export const facturesARembourser = pgTable(
  "factures_a_rembourser",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dateFacture: date("date_facture"),
    dateEnvoi: date("date_envoi"),
    natureOperation: text("nature_operation").notNull(),
    numeroFactureExterne: text("numero_facture_externe"),
    numeroBdc: text("numero_bdc"),
    montant: numeric("montant", { precision: 18, scale: 2 }).notNull(),
    devise: text("devise").notNull(),
    statut: text("statut").notNull().default("A_COMPTABILISER"),
    observation: text("observation"),
  },
  (t) => [
    check("factures_a_rembourser_devise_check", sql`${t.devise} in ('CDF','USD')`),
    check(
      "factures_a_rembourser_statut_check",
      sql`${t.statut} in ('A_COMPTABILISER','ATTENTE_BDC','NON_PAYE','PAYE')`,
    ),
  ],
);

// ----------------------------------------------------------------------------
// 7. DISTRIBUTION / CREDIT D'ABONNEMENTS
// ----------------------------------------------------------------------------
export const operationsDistribution = pgTable(
  "operations_distribution",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dateOperation: date("date_operation").notNull(),
    distributeurId: uuid("distributeur_id").references(() => distributeurs.id),
    typeOperation: text("type_operation").notNull(),
    description: text("description"),
    canalPaiementId: smallint("canal_paiement_id")
      .notNull()
      .references(() => canauxPaiement.id),
    montantCreditation: numeric("montant_creditation", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    montantApprovisionnement: numeric("montant_approvisionnement", {
      precision: 18,
      scale: 2,
    })
      .notNull()
      .default("0"),
    statut: text("statut").notNull().default("COMPTANT"),
    responsableId: uuid("responsable_id").references(() => employes.id),
    devise: text("devise").notNull().default("CDF"),
  },
  (t) => [
    check(
      "operations_distribution_type_check",
      sql`${t.typeOperation} in ('CREDITATION','APPROVISIONNEMENT','AUTRE')`,
    ),
    check("operations_distribution_statut_check", sql`${t.statut} in ('COMPTANT','CREDIT')`),
    check("operations_distribution_devise_check", sql`${t.devise} in ('CDF','USD')`),
  ],
);

export const stockInitial = pgTable(
  "stock_initial",
  {
    id: smallint("id").primaryKey().generatedAlwaysAsIdentity(),
    dateReference: date("date_reference").notNull(),
    montant: numeric("montant", { precision: 18, scale: 2 }).notNull(),
    devise: text("devise").notNull(),
  },
  (t) => [check("stock_initial_devise_check", sql`${t.devise} in ('CDF','USD')`)],
);

// ----------------------------------------------------------------------------
// 8. DEPENSES
// ----------------------------------------------------------------------------
export const depensesPersonnel = pgTable(
  "depenses_personnel",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeId: uuid("employe_id")
      .notNull()
      .references(() => employes.id),
    typeDepense: text("type_depense").notNull(),
    moisConcerne: date("mois_concerne").notNull(),
    montant: numeric("montant", { precision: 18, scale: 2 }).notNull(),
    devise: text("devise").notNull(),
    datePaiement: date("date_paiement"),
    statut: text("statut").notNull().default("NON_PAYE"),
    observation: text("observation"),
  },
  (t) => [
    check(
      "depenses_personnel_type_check",
      sql`${t.typeDepense} in ('SALAIRE','AVANCE','PRIME','AUTRE')`,
    ),
    check("depenses_personnel_devise_check", sql`${t.devise} in ('CDF','USD')`),
    check("depenses_personnel_statut_check", sql`${t.statut} in ('NON_PAYE','PAYE')`),
  ],
);

export const depensesFonctionnement = pgTable(
  "depenses_fonctionnement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categorie: text("categorie").notNull(),
    montant: numeric("montant", { precision: 18, scale: 2 }).notNull(),
    devise: text("devise").notNull(),
    dateDepense: date("date_depense").notNull(),
    fournisseur: text("fournisseur"),
    justificatifUrl: text("justificatif_url"),
    observation: text("observation"),
  },
  (t) => [check("depenses_fonctionnement_devise_check", sql`${t.devise} in ('CDF','USD')`)],
);

// ----------------------------------------------------------------------------
// 9. CAISSE / TRESORERIE UNIFIEE
// ----------------------------------------------------------------------------
export const mouvementsCaisse = pgTable(
  "mouvements_caisse",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dateMouvement: date("date_mouvement").notNull(),
    canalPaiementId: smallint("canal_paiement_id")
      .notNull()
      .references(() => canauxPaiement.id),
    sens: text("sens").notNull(),
    montant: numeric("montant", { precision: 18, scale: 2 }).notNull(),
    devise: text("devise").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id"),
    observation: text("observation"),
  },
  (t) => [
    check("mouvements_caisse_sens_check", sql`${t.sens} in ('ENTREE','SORTIE')`),
    check("mouvements_caisse_devise_check", sql`${t.devise} in ('CDF','USD')`),
    check(
      "mouvements_caisse_source_type_check",
      sql`${t.sourceType} in ('FACTURE','OPERATION_DISTRIBUTION','DEPENSE_PERSONNEL','DEPENSE_FONCTIONNEMENT','AUTRE')`,
    ),
  ],
);
