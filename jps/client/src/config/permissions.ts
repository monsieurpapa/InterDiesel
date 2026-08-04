/**
 * Copie côté client de la matrice d'autorisation du serveur
 * (server/src/auth/permissions.ts) — sert uniquement à masquer les sections
 * inaccessibles pour l'ergonomie. Le serveur est seul responsable de la
 * sécurité réelle ; toute tentative d'accès est revérifiée là-bas.
 */

export type Role = "ADMIN" | "GESTIONNAIRE" | "COMPTABLE" | "CAISSIER" | "LECTURE_SEULE";

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

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrateur",
  GESTIONNAIRE: "Gestionnaire",
  COMPTABLE: "Comptable",
  CAISSIER: "Caissier",
  LECTURE_SEULE: "Lecture seule",
};

export function canAccess(role: Role, mod: Module): boolean {
  return ROLE_PERMISSIONS[role][mod] !== "none";
}

export function canWrite(role: Role, mod: Module): boolean {
  return ROLE_PERMISSIONS[role][mod] === "write";
}
