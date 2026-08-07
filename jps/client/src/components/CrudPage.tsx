import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Plus, Search, X } from "lucide-react";
import { apiCreate, apiDelete, apiList, apiUpdate } from "../api";
import { groupTitleForPath, moduleForPath } from "../config/modules";
import { Badge } from "./Badge";
import { useAuth } from "../auth/AuthContext";
import { canWrite } from "../config/permissions";

export type FieldType = "text" | "number" | "date" | "checkbox" | "select" | "textarea";

export interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  defaultValue?: unknown;
  /** Pour type "select" référençant une autre ressource CRUD (ex: clients). */
  optionsResource?: string;
  optionsLabelKey?: string; // clé du libellé affiché, ex "nom"
  /** Pour type "select" avec valeurs fixes (ex: statut) — affiché comme badge dans le tableau. */
  staticOptions?: { value: string; label: string }[];
}

interface CrudPageProps {
  resource: string;
  title: string;
  fields: FieldConfig[];
  /** Colonnes affichées dans le tableau ; par défaut les mêmes clés que fields. */
  columns?: { key: string; label: string }[];
}

type Row = Record<string, any>;

export function CrudPage({ resource, title, fields, columns }: CrudPageProps) {
  const location = useLocation();
  const [rows, setRows] = useState<Row[]>([]);
  const [optionsByResource, setOptionsByResource] = useState<Record<string, Row[]>>({});
  const [editing, setEditing] = useState<Row | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});

  const displayColumns = columns ?? fields.map((f) => ({ key: f.key, label: f.label }));
  const eyebrow = groupTitleForPath(location.pathname);
  const { user } = useAuth();
  const canEdit = !!user && canWrite(user.role, moduleForPath(location.pathname));

  // Colonnes filtrables par menu déroulant : uniquement les champs "select"
  // affichés dans le tableau (statut, type, références...) — le texte libre
  // se cherche via la barre de recherche.
  const filterableFields = fields.filter(
    (f) => f.type === "select" && displayColumns.some((c) => c.key === f.key),
  );

  async function reload() {
    setLoading(true);
    try {
      setRows(await apiList(resource));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    setSearch("");
    setColumnFilters({});
    const resourcesToFetch = Array.from(
      new Set(fields.filter((f) => f.optionsResource).map((f) => f.optionsResource!)),
    );
    resourcesToFetch.forEach(async (res) => {
      const data = await apiList(res);
      setOptionsByResource((prev) => ({ ...prev, [res]: data }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource]);

  function openNew() {
    const initial: Row = {};
    fields.forEach((f) => {
      initial[f.key] = f.defaultValue ?? (f.type === "checkbox" ? false : "");
    });
    setEditing(initial);
    setShowForm(true);
  }

  function openEdit(row: Row) {
    setEditing({ ...row });
    setShowForm(true);
  }

  async function handleDelete(row: Row) {
    if (!confirm("Supprimer cet enregistrement ?")) return;
    try {
      await apiDelete(resource, row.id);
      await reload();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    // Un champ optionnel laissé vide envoie "" — la base rejette "" pour les
    // colonnes smallint/uuid, il faut transmettre null.
    const payload = { ...editing };
    for (const key of Object.keys(payload)) {
      if (payload[key] === "") payload[key] = null;
    }
    try {
      if (editing.id) {
        await apiUpdate(resource, editing.id, payload);
      } else {
        await apiCreate(resource, payload);
      }
      setShowForm(false);
      setEditing(null);
      await reload();
    } catch (err: any) {
      setError(err.message);
    }
  }

  /** Libellé texte d'une cellule — utilisé à la fois pour l'affichage et la recherche. */
  function cellText(row: Row, key: string): string {
    const field = fields.find((f) => f.key === key);
    const value = row[key];
    if (field?.type === "select" && field.staticOptions) {
      return field.staticOptions.find((o) => o.value === value)?.label ?? String(value ?? "");
    }
    if (field?.type === "select" && field.optionsResource) {
      const options = optionsByResource[field.optionsResource] ?? [];
      const match = options.find((o) => o.id === value);
      return match ? String(match[field.optionsLabelKey ?? "nom"] ?? "") : "";
    }
    if (field?.type === "checkbox" || typeof value === "boolean") {
      return value ? "Oui" : "Non";
    }
    return value == null ? "" : String(value);
  }

  function renderCell(row: Row, key: string) {
    const field = fields.find((f) => f.key === key);
    const value = row[key];
    if (field?.type === "select" && field.staticOptions) {
      return <Badge value={value} />;
    }
    if (field?.type === "select" && field.optionsResource) {
      const text = cellText(row, key);
      return text || "—";
    }
    if (field?.type === "checkbox" || typeof value === "boolean") {
      return <Badge value={value ? "ACTIF" : "TERMINE"} />;
    }
    return value ?? "—";
  }

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      for (const [key, want] of Object.entries(columnFilters)) {
        if (want && String(row[key] ?? "") !== want) return false;
      }
      if (!term) return true;
      return displayColumns.some((c) => cellText(row, c.key).toLowerCase().includes(term));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, columnFilters, optionsByResource]);

  const hasActiveFilters = search.trim() !== "" || Object.values(columnFilters).some(Boolean);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          {eyebrow && <div className="page-header-eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
        </div>
        {canEdit && (
          <button className="btn-primary" onClick={openNew}>
            <Plus size={16} /> Nouveau
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="table-toolbar">
        <div className="search-field">
          <Search size={15} />
          <input
            type="text"
            placeholder="Rechercher…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" className="search-clear" onClick={() => setSearch("")}>
              <X size={13} />
            </button>
          )}
        </div>
        {filterableFields.map((f) => {
          const options =
            f.staticOptions ??
            (optionsByResource[f.optionsResource ?? ""] ?? []).map((o) => ({
              value: o.id,
              label: o[f.optionsLabelKey ?? "nom"],
            }));
          return (
            <select
              key={f.key}
              className="filter-select"
              value={columnFilters[f.key] ?? ""}
              onChange={(e) => setColumnFilters({ ...columnFilters, [f.key]: e.target.value })}
            >
              <option value="">{f.label} : tous</option>
              {options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          );
        })}
        {hasActiveFilters && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setSearch("");
              setColumnFilters({});
            }}
          >
            Réinitialiser
          </button>
        )}
      </div>

      {loading ? (
        <p className="stat-helper">Chargement…</p>
      ) : (
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                {displayColumns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id}>
                  {displayColumns.map((c) => (
                    <td key={c.key}>{renderCell(row, c.key)}</td>
                  ))}
                  {canEdit && (
                    <td className="actions-cell">
                      <button onClick={() => openEdit(row)}>Modifier</button>
                      <button className="btn-danger" onClick={() => handleDelete(row)}>
                        Supprimer
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={displayColumns.length + (canEdit ? 1 : 0)} className="empty-row">
                    {rows.length === 0
                      ? "Aucune donnée pour l'instant."
                      : "Aucun résultat pour cette recherche."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && editing && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
            <h2>{editing.id ? "Modifier" : "Nouveau"}</h2>
            {fields.map((f) => (
              <label key={f.key} className="form-field">
                <span>{f.label}</span>
                {f.type === "select" ? (
                  <select
                    required={f.required}
                    value={editing[f.key] ?? ""}
                    onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}
                  >
                    <option value="">—</option>
                    {(f.staticOptions ??
                      (optionsByResource[f.optionsResource ?? ""] ?? []).map((o) => ({
                        value: o.id,
                        label: o[f.optionsLabelKey ?? "nom"],
                      }))
                    ).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : f.type === "checkbox" ? (
                  <input
                    type="checkbox"
                    checked={!!editing[f.key]}
                    onChange={(e) => setEditing({ ...editing, [f.key]: e.target.checked })}
                  />
                ) : f.type === "textarea" ? (
                  <textarea
                    required={f.required}
                    value={editing[f.key] ?? ""}
                    onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}
                  />
                ) : (
                  <input
                    type={f.type}
                    step={f.type === "number" ? "0.01" : undefined}
                    required={f.required}
                    value={editing[f.key] ?? ""}
                    onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}
                  />
                )}
              </label>
            ))}
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
