export type Role = "ADMIN" | "GESTIONNAIRE" | "COMPTABLE" | "CAISSIER" | "LECTURE_SEULE";

export const ROLES: Role[] = ["ADMIN", "GESTIONNAIRE", "COMPTABLE", "CAISSIER", "LECTURE_SEULE"];

export type Module =
  | "facturation"
  | "transport"
  | "locations"
  | "distribution"
  | "tresorerie"
  | "personnel"
  | "referentiel"
  | "dashboard"
  | "admin";

export type Access = "none" | "read" | "write";

/**
 * Matrice d'autorisation faisant autorité — c'est le serveur qui l'applique
 * sur chaque requête. Le client a une copie de cette table uniquement pour
 * masquer les sections inaccessibles ; toute vérification de sécurité réelle
 * se fait ici.
 */
export const ROLE_PERMISSIONS: Record<Role, Record<Module, Access>> = {
  ADMIN: {
    facturation: "write",
    transport: "write",
    locations: "write",
    distribution: "write",
    tresorerie: "write",
    personnel: "write",
    referentiel: "write",
    dashboard: "read",
    admin: "write",
  },
  GESTIONNAIRE: {
    facturation: "write",
    transport: "write",
    locations: "write",
    distribution: "write",
    tresorerie: "write",
    personnel: "write",
    referentiel: "write",
    dashboard: "read",
    admin: "none",
  },
  COMPTABLE: {
    facturation: "write",
    transport: "read",
    locations: "read",
    distribution: "read",
    tresorerie: "write",
    personnel: "write",
    referentiel: "read",
    dashboard: "read",
    admin: "none",
  },
  CAISSIER: {
    facturation: "read",
    transport: "read",
    locations: "read",
    distribution: "write",
    tresorerie: "write",
    personnel: "none",
    referentiel: "read",
    dashboard: "read",
    admin: "none",
  },
  LECTURE_SEULE: {
    facturation: "read",
    transport: "read",
    locations: "read",
    distribution: "read",
    tresorerie: "read",
    personnel: "read",
    referentiel: "read",
    dashboard: "read",
    admin: "none",
  },
};

/** Fait correspondre chaque préfixe de route API à son module d'autorisation. */
export const RESOURCE_MODULE: Record<string, Module> = {
  clients: "facturation",
  services: "facturation",
  factures: "facturation",
  "factures-a-rembourser": "facturation",
  encaissements: "facturation",
  "tarifs-transport": "transport",
  "contrats-location": "locations",
  vehicules: "locations",
  distributeurs: "distribution",
  "operations-distribution": "distribution",
  "mouvements-caisse": "tresorerie",
  employes: "personnel",
  "depenses-personnel": "personnel",
  "depenses-fonctionnement": "personnel",
  "canaux-paiement": "referentiel",
  "categories-activite": "referentiel",
  dashboard: "dashboard",
  utilisateurs: "admin",
};

export function hasAccess(role: Role, mod: Module, needed: Access): boolean {
  if (needed === "none") return true;
  const level = ROLE_PERMISSIONS[role][mod];
  if (needed === "read") return level === "read" || level === "write";
  return level === "write";
}

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrateur",
  GESTIONNAIRE: "Gestionnaire",
  COMPTABLE: "Comptable",
  CAISSIER: "Caissier",
  LECTURE_SEULE: "Lecture seule",
};
