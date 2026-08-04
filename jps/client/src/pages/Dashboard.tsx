import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FilePlus2, Wallet2, Activity, Landmark, Users2, Boxes } from "lucide-react";
import { MODULE_COLOR_HEX, accentStyle } from "../config/modules";
import { apiList } from "../api";
import { useAuth } from "../auth/AuthContext";
import { canAccess, canWrite, type Module } from "../config/permissions";

interface CaMensuel {
  mois: string;
  devise: string;
  chiffre_affaires_ht: string;
}
interface SyntheseJournaliere {
  date_mouvement: string;
  canal_paiement_id: number;
  devise: string;
  total_entrees: string;
  total_sorties: string;
  solde_net: string;
}
interface SoldeStock {
  stock_actuel: string | null;
}

const QUICK_ACTIONS: { to: string; label: string; icon: typeof FilePlus2; color: string; module: Module }[] = [
  { to: "/factures", label: "Nouvelle facture", icon: FilePlus2, color: MODULE_COLOR_HEX.blue, module: "facturation" },
  { to: "/mouvements-caisse", label: "Mouvement de caisse", icon: Wallet2, color: MODULE_COLOR_HEX.emerald, module: "tresorerie" },
  { to: "/operations-distribution", label: "Opération de distribution", icon: Activity, color: MODULE_COLOR_HEX.teal, module: "distribution" },
  { to: "/depenses-fonctionnement", label: "Dépense de bureau", icon: Landmark, color: MODULE_COLOR_HEX.rose, module: "personnel" },
];

export function Dashboard() {
  const [ca, setCa] = useState<CaMensuel[]>([]);
  const [synthese, setSynthese] = useState<SyntheseJournaliere[]>([]);
  const [stock, setStock] = useState<SoldeStock | null>(null);
  const [clientCount, setClientCount] = useState<number | null>(null);
  const [factureCount, setFactureCount] = useState<number | null>(null);

  const { user } = useAuth();

  useEffect(() => {
    apiList("dashboard/chiffre-affaires-mensuel").then(setCa);
    apiList("dashboard/synthese-journaliere").then(setSynthese);
    apiList("dashboard/solde-stock-distribution").then(setStock);
    if (user && canAccess(user.role, "facturation")) {
      apiList("clients").then((rows) => setClientCount(rows.length));
      apiList("factures").then((rows) => setFactureCount(rows.length));
    }
  }, [user]);

  const totalCaHt = ca.reduce((sum, row) => sum + Number(row.chiffre_affaires_ht || 0), 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-header-eyebrow">Vue d'ensemble</div>
          <h1>Tableau de bord</h1>
        </div>
      </div>

      <div className="quick-actions">
        {QUICK_ACTIONS.filter((action) => user && canWrite(user.role, action.module)).map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.to}
              to={action.to}
              className="quick-action-btn"
              style={{ background: action.color }}
            >
              <Icon size={16} /> {action.label}
            </Link>
          );
        })}
      </div>

      <div className="stat-cards">
        <div className="stat-card" style={accentStyle("blue")}>
          <div className="stat-card-icon">
            <Users2 size={16} />
          </div>
          <div className="stat-label">Clients</div>
          <div className="stat-value">{clientCount ?? "…"}</div>
          <div className="stat-helper">Fiches enregistrées</div>
        </div>

        <div className="stat-card" style={accentStyle("blue")}>
          <div className="stat-card-icon">
            <Boxes size={16} />
          </div>
          <div className="stat-label">Chiffre d'affaires cumulé</div>
          <div className="stat-value">{totalCaHt.toLocaleString("fr-FR")}</div>
          <div className="stat-helper">{factureCount ?? 0} facture(s) émise(s)</div>
        </div>

        <div className="stat-card" style={accentStyle("teal")}>
          <div className="stat-card-icon">
            <Activity size={16} />
          </div>
          <div className="stat-label">Stock du réseau de distribution</div>
          <div className="stat-value">
            {stock?.stock_actuel != null ? Number(stock.stock_actuel).toLocaleString("fr-FR") : "—"}
          </div>
          <div className="stat-helper">
            {stock?.stock_actuel != null ? "Solde actuel" : "Renseigner le stock initial"}
          </div>
        </div>
      </div>

      <section>
        <h2>Chiffre d'affaires mensuel</h2>
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mois</th>
                <th>Devise</th>
                <th>Chiffre d'affaires HT</th>
              </tr>
            </thead>
            <tbody>
              {ca.map((row, i) => (
                <tr key={i}>
                  <td>{new Date(row.mois).toLocaleDateString("fr-FR", { year: "numeric", month: "long" })}</td>
                  <td>{row.devise}</td>
                  <td>{Number(row.chiffre_affaires_ht).toLocaleString("fr-FR")}</td>
                </tr>
              ))}
              {ca.length === 0 && (
                <tr>
                  <td colSpan={3} className="empty-row">Aucune facture pour l'instant.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Synthèse journalière de caisse</h2>
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Canal</th>
                <th>Devise</th>
                <th>Entrées</th>
                <th>Sorties</th>
                <th>Solde net</th>
              </tr>
            </thead>
            <tbody>
              {synthese.map((row, i) => (
                <tr key={i}>
                  <td>{new Date(row.date_mouvement).toLocaleDateString("fr-FR")}</td>
                  <td>{row.canal_paiement_id}</td>
                  <td>{row.devise}</td>
                  <td>{Number(row.total_entrees).toLocaleString("fr-FR")}</td>
                  <td>{Number(row.total_sorties).toLocaleString("fr-FR")}</td>
                  <td>{Number(row.solde_net).toLocaleString("fr-FR")}</td>
                </tr>
              ))}
              {synthese.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-row">Aucun mouvement de caisse pour l'instant.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
