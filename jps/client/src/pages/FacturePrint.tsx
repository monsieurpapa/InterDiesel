import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Printer, ArrowLeft } from "lucide-react";
import { apiGet, apiList } from "../api";

interface Entreprise {
  nom: string;
  adresse: string | null;
  ville: string | null;
  telephone: string | null;
  nImpot: string | null;
  idNational: string | null;
  rccm: string | null;
  coordonneesBancaires: string | null;
}
interface Client {
  nom: string;
  type: string | null;
  adresse: string | null;
  ville: string | null;
  telephone: string | null;
  email: string | null;
  nImpot: string | null;
  rccm: string | null;
}
interface Ligne {
  id: string;
  description: string;
  quantite: string;
  prixUnitaire: string;
  tauxTva: string;
  montantHt: string;
}
interface Facture {
  id: string;
  numero: string;
  type: string;
  dateFacture: string;
  dateEcheance: string | null;
  moyenReglementId: number | null;
  remisePct: string;
  devise: string;
  statut: string;
  client: Client;
  lignes: Ligne[];
}
interface CanalPaiement {
  id: number;
  libelle: string;
}

const STATUT_LABELS: Record<string, string> = {
  BROUILLON: "Brouillon",
  EMISE: "Émise",
  PAYEE: "Payée",
  PARTIELLEMENT_PAYEE: "Partiellement payée",
  ANNULEE: "Annulée",
};

function formatMontant(n: number, devise: string) {
  return `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;
}

export function FacturePrint() {
  const { id } = useParams<{ id: string }>();
  const [facture, setFacture] = useState<Facture | null>(null);
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [canaux, setCanaux] = useState<CanalPaiement[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    apiGet("factures", id).then(setFacture).catch((err) => setError(err.message));
    apiList("entreprise").then(setEntreprise);
    apiList("canaux-paiement").then(setCanaux);
  }, [id]);

  if (error) {
    return (
      <div className="page">
        <div className="error-banner">{error}</div>
      </div>
    );
  }
  if (!facture) {
    return (
      <div className="page">
        <p className="stat-helper">Chargement…</p>
      </div>
    );
  }

  const moyenLibelle = canaux.find((c) => c.id === facture.moyenReglementId)?.libelle;
  const remisePct = Number(facture.remisePct);
  const sousTotalHt = facture.lignes.reduce((sum, l) => sum + Number(l.montantHt), 0);
  let totalRemise = 0;
  let totalTva = 0;
  let totalTtc = 0;
  const lignesCalc = facture.lignes.map((l) => {
    const montantHt = Number(l.montantHt);
    const remise = montantHt * remisePct;
    const netHt = montantHt - remise;
    const tva = netHt * Number(l.tauxTva);
    totalRemise += remise;
    totalTva += tva;
    totalTtc += netHt + tva;
    return { ...l, montantHt, netHt, tva };
  });

  return (
    <div className="invoice-print-screen">
      <div className="invoice-toolbar no-print">
        <Link to="/factures">
          <ArrowLeft size={15} /> Retour aux factures
        </Link>
        <button className="btn-primary" onClick={() => window.print()}>
          <Printer size={16} /> Imprimer / Enregistrer en PDF
        </button>
      </div>

      <div className="invoice-print-page">
        <div className="invoice-header">
          <div className="invoice-entreprise">
            <div className="invoice-entreprise-nom">{entreprise?.nom ?? "—"}</div>
            {entreprise?.adresse && <div>{entreprise.adresse}</div>}
            {entreprise?.ville && <div>{entreprise.ville}</div>}
            {entreprise?.telephone && <div>Tél : {entreprise.telephone}</div>}
            {entreprise?.nImpot && <div>N° Impôt : {entreprise.nImpot}</div>}
            {entreprise?.idNational && <div>ID National : {entreprise.idNational}</div>}
            {entreprise?.rccm && <div>RCCM : {entreprise.rccm}</div>}
          </div>
          <div className="invoice-meta">
            <div className="invoice-titre">{facture.type === "PROFORMA" ? "PROFORMA" : "FACTURE"}</div>
            <div className="invoice-numero">N° {facture.numero}</div>
            <div>Date : {new Date(facture.dateFacture).toLocaleDateString("fr-FR")}</div>
            {facture.dateEcheance && (
              <div>Échéance : {new Date(facture.dateEcheance).toLocaleDateString("fr-FR")}</div>
            )}
            <div>Statut : {STATUT_LABELS[facture.statut] ?? facture.statut}</div>
          </div>
        </div>

        <div className="invoice-client">
          <div className="invoice-section-label">Facturé à</div>
          <div className="invoice-client-nom">{facture.client.nom}</div>
          {facture.client.adresse && <div>{facture.client.adresse}</div>}
          {facture.client.ville && <div>{facture.client.ville}</div>}
          {facture.client.telephone && <div>Tél : {facture.client.telephone}</div>}
          {facture.client.email && <div>{facture.client.email}</div>}
          {facture.client.nImpot && <div>N° Impôt : {facture.client.nImpot}</div>}
          {facture.client.rccm && <div>RCCM : {facture.client.rccm}</div>}
        </div>

        <table className="invoice-lignes">
          <thead>
            <tr>
              <th>Description</th>
              <th>Qté</th>
              <th>Prix unitaire</th>
              <th>TVA</th>
              <th>Montant HT</th>
            </tr>
          </thead>
          <tbody>
            {lignesCalc.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td className="num">{Number(l.quantite).toLocaleString("fr-FR")}</td>
                <td className="num">{Number(l.prixUnitaire).toLocaleString("fr-FR")}</td>
                <td className="num">{(Number(l.tauxTva) * 100).toLocaleString("fr-FR")} %</td>
                <td className="num">{l.montantHt.toLocaleString("fr-FR")}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="invoice-totaux">
          <div>
            <span>Sous-total HT</span>
            <span>{formatMontant(sousTotalHt, facture.devise)}</span>
          </div>
          {remisePct > 0 && (
            <div>
              <span>Remise ({(remisePct * 100).toLocaleString("fr-FR")} %)</span>
              <span>-{formatMontant(totalRemise, facture.devise)}</span>
            </div>
          )}
          <div>
            <span>TVA</span>
            <span>{formatMontant(totalTva, facture.devise)}</span>
          </div>
          <div className="invoice-total-ttc">
            <span>Total TTC</span>
            <span>{formatMontant(totalTtc, facture.devise)}</span>
          </div>
        </div>

        <div className="invoice-paiement">
          {moyenLibelle && <div>Moyen de règlement : {moyenLibelle}</div>}
          {entreprise?.coordonneesBancaires && (
            <div>Coordonnées bancaires : {entreprise.coordonneesBancaires}</div>
          )}
        </div>

        <div className="invoice-footer">Merci de votre confiance.</div>
      </div>
    </div>
  );
}
