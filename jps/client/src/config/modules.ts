import type { CSSProperties } from "react";
import {
  LayoutDashboard,
  Users,
  Package,
  FileText,
  ReceiptText,
  Truck,
  Building2,
  Car,
  Share2,
  Activity,
  Wallet,
  UserCog,
  Banknote,
  Landmark,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { Module } from "./permissions";

export type ModuleColor = "slate" | "blue" | "amber" | "violet" | "teal" | "emerald" | "rose";

/** Couleur pleine (icônes, badges, boutons) et déclinaison douce (fonds de carte sur blanc). */
export const MODULE_COLOR_HEX: Record<ModuleColor, string> = {
  slate: "#475569",
  blue: "#2563eb",
  amber: "#b45309",
  violet: "#7c3aed",
  teal: "#0d9488",
  emerald: "#059669",
  rose: "#be185d",
};

export const MODULE_COLOR_SOFT: Record<ModuleColor, string> = {
  slate: "#f1f5f9",
  blue: "#eff6ff",
  amber: "#fffbeb",
  violet: "#f5f3ff",
  teal: "#f0fdfa",
  emerald: "#ecfdf5",
  rose: "#fdf2f8",
};

/** Variables CSS --accent / --accent-soft à poser sur un conteneur pour teinter ses enfants. */
export function accentStyle(color: ModuleColor): CSSProperties {
  return {
    ["--accent" as string]: MODULE_COLOR_HEX[color],
    ["--accent-soft" as string]: MODULE_COLOR_SOFT[color],
  } as CSSProperties;
}

export interface NavLinkConfig {
  to: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroupConfig {
  title: string;
  color: ModuleColor;
  module: Module;
  links: NavLinkConfig[];
}

export const NAV_GROUPS: NavGroupConfig[] = [
  {
    title: "Général",
    color: "slate",
    module: "dashboard",
    links: [{ to: "/", label: "Tableau de bord", icon: LayoutDashboard }],
  },
  {
    title: "Facturation clients",
    color: "blue",
    module: "facturation",
    links: [
      { to: "/clients", label: "Clients", icon: Users },
      { to: "/services", label: "Services & produits", icon: Package },
      { to: "/factures", label: "Factures", icon: FileText },
      { to: "/factures-a-rembourser", label: "Factures à rembourser", icon: ReceiptText },
    ],
  },
  {
    title: "Transport",
    color: "amber",
    module: "transport",
    links: [{ to: "/tarifs-transport", label: "Grille tarifaire", icon: Truck }],
  },
  {
    title: "Locations",
    color: "violet",
    module: "locations",
    links: [
      { to: "/contrats-location", label: "Contrats (entrepôt / véhicule)", icon: Building2 },
      { to: "/vehicules", label: "Véhicules", icon: Car },
    ],
  },
  {
    title: "Distribution / Abonnements",
    color: "teal",
    module: "distribution",
    links: [
      { to: "/distributeurs", label: "Distributeurs", icon: Share2 },
      { to: "/operations-distribution", label: "Journal des opérations", icon: Activity },
    ],
  },
  {
    title: "Trésorerie",
    color: "emerald",
    module: "tresorerie",
    links: [{ to: "/mouvements-caisse", label: "Mouvements de caisse", icon: Wallet }],
  },
  {
    title: "Personnel & Bureau",
    color: "rose",
    module: "personnel",
    links: [
      { to: "/employes", label: "Employés", icon: UserCog },
      { to: "/depenses-personnel", label: "Dépenses personnel", icon: Banknote },
      { to: "/depenses-fonctionnement", label: "Dépenses de fonctionnement", icon: Landmark },
    ],
  },
  {
    title: "Administration",
    color: "slate",
    module: "admin",
    links: [{ to: "/utilisateurs", label: "Utilisateurs", icon: ShieldCheck }],
  },
];

/** Retrouve la couleur de module associée à un chemin, pour teinter l'en-tête d'une page CRUD. */
export function colorForPath(pathname: string): ModuleColor {
  return groupForPath(pathname)?.color ?? "slate";
}

/** Retrouve le module d'autorisation associé à un chemin (pour les contrôles d'écriture). */
export function moduleForPath(pathname: string): Module {
  return groupForPath(pathname)?.module ?? "dashboard";
}

/** Retrouve le nom du groupe d'activité associé à un chemin (ex "Transport"). */
export function groupTitleForPath(pathname: string): string {
  return groupForPath(pathname)?.title ?? "";
}

function groupForPath(pathname: string): NavGroupConfig | undefined {
  return NAV_GROUPS.find((group) =>
    group.links.some((l) => (l.to === "/" ? pathname === "/" : pathname.startsWith(l.to))),
  );
}
