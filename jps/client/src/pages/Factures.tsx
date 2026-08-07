import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, X, Search, Printer } from "lucide-react";
import { apiCreate, apiDelete, apiList } from "../api";
import { Badge } from "../components/Badge";
import { useAuth } from "../auth/AuthContext";
import { canWrite } from "../config/permissions";

const TYPE_OPTIONS = [
  { value: "FACTURE", label: "Facture" },
  { value: "PROFORMA", label: "Proforma" },
];
const STATUT_OPTIONS = [
  { value: "BROUILLON", label: "Brouillon" },
  { value: "EMISE", label: "Émise" },
  { value: "PAYEE", label: "Payée" },
  { value: "PARTIELLEMENT_PAYEE", label: "Partiellement payée" },
  { value: "ANNULEE", label: "Annulée" },
];

interface Client {
  id: string;
  nom: string;
}
interface Service {
  id: string;
  description: string;
  prixUnitaire: string | null;
  tauxTva: string;
}
interface LigneForm {
  serviceId: string;
  description: string;
  quantite: string;
  prixUnitaire: string;
  tauxTva: string;
}
interface Facture {
  id: string;
  numero: string;
  type: string;
  clientId: string;
  dateFacture: string;
  devise: string;
  statut: string;
}

const LIGNE_VIDE: LigneForm = {
  serviceId: "",
  description: "",
  quantite: "1",
  prixUnitaire: "",
  tauxTva: "0",
};

export function Factures() {
  const { user } = useAuth();
  const canEdit = !!user && canWrite(user.role, "facturation");
  const [factures, setFactures] = useState<Facture[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statutFilter, setStatutFilter] = useState("");

  const [numero, setNumero] = useState("");
  const [type, setType] = useState("FACTURE");
  const [clientId, setClientId] = useState("");
  const [dateFacture, setDateFacture] = useState("");
  const [devise, setDevise] = useState("CDF");
  const [lignes, setLignes] = useState<LigneForm[]>([{ ...LIGNE_VIDE }]);

  async function reload() {
    setFactures(await apiList("factures"));
  }

  useEffect(() => {
    reload();
    apiList("clients").then(setClients);
    apiList("services").then(setServices);
  }, []);

  function updateLigne(index: number, patch: Partial<LigneForm>) {
    setLignes((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function ajouterLigne() {
    setLignes((prev) => [...prev, { ...LIGNE_VIDE }]);
  }

  function supprimerLigne(index: number) {
    setLignes((prev) => prev.filter((_, i) => i !== index));
  }

  function choisirService(index: number, serviceId: string) {
    const service = services.find((s) => s.id === serviceId);
    updateLigne(index, {
      serviceId,
      description: service?.description ?? "",
      prixUnitaire: service?.prixUnitaire ?? "",
      tauxTva: service?.tauxTva ?? "0",
    });
  }

  const total = lignes.reduce(
    (sum, l) => sum + Number(l.quantite || 0) * Number(l.prixUnitaire || 0),
    0,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiCreate("factures", {
        numero,
        type,
        clientId,
        dateFacture,
        devise,
        lignes: lignes
          .filter((l) => l.description && l.prixUnitaire)
          .map((l) => ({
            serviceId: l.serviceId || null,
            description: l.description,
            quantite: l.quantite,
            prixUnitaire: l.prixUnitaire,
            tauxTva: l.tauxTva,
          })),
      });
      setShowForm(false);
      setNumero("");
      setClientId("");
      setDateFacture("");
      setLignes([{ ...LIGNE_VIDE }]);
      await reload();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Supprimer cette facture ?")) return;
    await apiDelete("factures", id);
    await reload();
  }

  function nomClient(id: string) {
    return clients.find((c) => c.id === id)?.nom ?? id;
  }

  const filteredFactures = useMemo(() => {
    const term = search.trim().toLowerCase();
    return factures.filter((f) => {
      if (typeFilter && f.type !== typeFilter) return false;
      if (statutFilter && f.statut !== statutFilter) return false;
      if (!term) return true;
      const haystack = `${f.numero} ${nomClient(f.clientId)} ${f.devise}`.toLowerCase();
      return haystack.includes(term);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factures, search, typeFilter, statutFilter, clients]);

  const hasActiveFilters = search.trim() !== "" || typeFilter !== "" || statutFilter !== "";

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-header-eyebrow">Facturation clients</div>
          <h1>Factures &amp; proformas</h1>
        </div>
        {canEdit && (
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={16} /> Nouvelle facture
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="table-toolbar">
        <div className="search-field">
          <Search size={15} />
          <input
            type="text"
            placeholder="Rechercher (numéro, client, devise)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" className="search-clear" onClick={() => setSearch("")}>
              <X size={13} />
            </button>
          )}
        </div>
        <select className="filter-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">Type : tous</option>
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select className="filter-select" value={statutFilter} onChange={(e) => setStatutFilter(e.target.value)}>
          <option value="">Statut : tous</option>
          {STATUT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {hasActiveFilters && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setSearch("");
              setTypeFilter("");
              setStatutFilter("");
            }}
          >
            Réinitialiser
          </button>
        )}
      </div>

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>N°</th>
              <th>Type</th>
              <th>Client</th>
              <th>Date</th>
              <th>Devise</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredFactures.map((f) => (
              <tr key={f.id}>
                <td>{f.numero}</td>
                <td>{f.type}</td>
                <td>{nomClient(f.clientId)}</td>
                <td>{new Date(f.dateFacture).toLocaleDateString("fr-FR")}</td>
                <td>{f.devise}</td>
                <td><Badge value={f.statut} /></td>
                <td className="actions-cell">
                  <Link to={`/factures/${f.id}/imprimer`} target="_blank" rel="noopener noreferrer">
                    <Printer size={13} /> Imprimer
                  </Link>
                  {canEdit && (
                    <button className="btn-danger" onClick={() => handleDelete(f.id)}>
                      Supprimer
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filteredFactures.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-row">
                  {factures.length === 0
                    ? "Aucune facture pour l'instant."
                    : "Aucun résultat pour cette recherche."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <form className="modal modal-wide" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
            <h2>Nouvelle facture</h2>

            <div className="form-grid">
              <label className="form-field">
                <span>Numéro</span>
                <input required value={numero} onChange={(e) => setNumero(e.target.value)} />
              </label>
              <label className="form-field">
                <span>Type</span>
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="FACTURE">Facture</option>
                  <option value="PROFORMA">Proforma</option>
                </select>
              </label>
              <label className="form-field">
                <span>Client</span>
                <select required value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">—</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nom}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Date facture</span>
                <input
                  type="date"
                  required
                  value={dateFacture}
                  onChange={(e) => setDateFacture(e.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Devise</span>
                <select value={devise} onChange={(e) => setDevise(e.target.value)}>
                  <option value="CDF">CDF</option>
                  <option value="USD">USD</option>
                </select>
              </label>
            </div>

            <h3>Lignes de facture</h3>
            <div className="lignes-table-scroll">
            <table className="data-table lignes-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Description</th>
                  <th>Qté</th>
                  <th>Prix unitaire</th>
                  <th>TVA</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <select value={l.serviceId} onChange={(e) => choisirService(i, e.target.value)}>
                        <option value="">— libre —</option>
                        {services.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.description}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        value={l.description}
                        onChange={(e) => updateLigne(i, { description: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        value={l.quantite}
                        onChange={(e) => updateLigne(i, { quantite: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        value={l.prixUnitaire}
                        onChange={(e) => updateLigne(i, { prixUnitaire: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        value={l.tauxTva}
                        onChange={(e) => updateLigne(i, { tauxTva: e.target.value })}
                      />
                    </td>
                    <td>
                      <button type="button" className="btn-danger" onClick={() => supprimerLigne(i)}>
                        <X size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <button type="button" className="btn-ghost" onClick={ajouterLigne}>
              <Plus size={14} /> Ajouter une ligne
            </button>

            <div className="facture-total">Total HT : {total.toLocaleString("fr-FR")} {devise}</div>

            <div className="modal-actions">
              <button type="button" onClick={() => setShowForm(false)}>
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                Enregistrer
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
