import { useEffect, useState } from "react";
import { Plus, Copy, KeyRound } from "lucide-react";
import { apiCreate, apiDelete, apiList, apiUpdate } from "../api";
import { Badge } from "../components/Badge";
import { useAuth } from "../auth/AuthContext";
import type { Role } from "../config/permissions";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "ADMIN", label: "Administrateur" },
  { value: "GESTIONNAIRE", label: "Gestionnaire" },
  { value: "COMPTABLE", label: "Comptable" },
  { value: "CAISSIER", label: "Caissier" },
  { value: "LECTURE_SEULE", label: "Lecture seule" },
];

interface Utilisateur {
  id: string;
  nom: string;
  email: string;
  role: Role;
  roleLabel: string;
  actif: boolean;
  doitChangerMotDePasse: boolean;
  derniereConnexionLe: string | null;
}

export function Utilisateurs() {
  const { user: moi } = useAuth();
  const [rows, setRows] = useState<Utilisateur[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("LECTURE_SEULE");

  const [editing, setEditing] = useState<Utilisateur | null>(null);

  const [revealName, setRevealName] = useState<string | null>(null);
  const [revealPassword, setRevealPassword] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    try {
      setRows(await apiList("utilisateurs"));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await apiCreate("utilisateurs", { nom, email, role });
      setShowCreate(false);
      setNom("");
      setEmail("");
      setRole("LECTURE_SEULE");
      setRevealName(created.nom);
      setRevealPassword(created.tempPassword);
      await reload();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    try {
      await apiUpdate("utilisateurs", editing.id, {
        nom: editing.nom,
        role: editing.role,
        actif: editing.actif,
      });
      setEditing(null);
      await reload();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleResetPassword(u: Utilisateur) {
    if (!confirm(`Générer un nouveau mot de passe temporaire pour ${u.nom} ?`)) return;
    setError(null);
    try {
      const body = await apiCreate(`utilisateurs/${u.id}/reset-password`, {});
      setRevealName(u.nom);
      setRevealPassword(body.tempPassword);
      await reload();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDelete(u: Utilisateur) {
    if (!confirm(`Supprimer le compte de ${u.nom} ?`)) return;
    try {
      await apiDelete("utilisateurs", u.id);
      await reload();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-header-eyebrow">Administration</div>
          <h1>Utilisateurs</h1>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus size={16} /> Nouveau
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <p className="stat-helper">Chargement…</p>
      ) : (
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>E-mail</th>
                <th>Rôle</th>
                <th>Statut</th>
                <th>Mot de passe</th>
                <th>Dernière connexion</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>{u.nom}</td>
                  <td>{u.email}</td>
                  <td>{u.roleLabel}</td>
                  <td><Badge value={u.actif ? "ACTIF" : "TERMINE"} /></td>
                  <td>
                    {u.doitChangerMotDePasse ? (
                      <Badge value="ATTENTE_BDC" />
                    ) : (
                      <span className="stat-helper">à jour</span>
                    )}
                  </td>
                  <td>
                    {u.derniereConnexionLe
                      ? new Date(u.derniereConnexionLe).toLocaleString("fr-FR")
                      : "—"}
                  </td>
                  <td className="actions-cell">
                    <button onClick={() => setEditing(u)}>Modifier</button>
                    <button onClick={() => handleResetPassword(u)}>
                      <KeyRound size={13} />
                    </button>
                    {u.id !== moi?.id && (
                      <button className="btn-danger" onClick={() => handleDelete(u)}>
                        Supprimer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-row">Aucun utilisateur pour l'instant.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleCreate}>
            <h2>Nouvel utilisateur</h2>
            <label className="form-field">
              <span>Nom</span>
              <input required value={nom} onChange={(e) => setNom(e.target.value)} />
            </label>
            <label className="form-field">
              <span>E-mail</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="form-field">
              <span>Rôle</span>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setShowCreate(false)}>Annuler</button>
              <button type="submit" className="btn-primary">Créer</button>
            </div>
          </form>
        </div>
      )}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleUpdate}>
            <h2>Modifier {editing.nom}</h2>
            <label className="form-field">
              <span>Nom</span>
              <input
                required
                value={editing.nom}
                onChange={(e) => setEditing({ ...editing, nom: e.target.value })}
              />
            </label>
            <label className="form-field">
              <span>Rôle</span>
              <select
                value={editing.role}
                onChange={(e) => setEditing({ ...editing, role: e.target.value as Role })}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Actif</span>
              <input
                type="checkbox"
                checked={editing.actif}
                onChange={(e) => setEditing({ ...editing, actif: e.target.checked })}
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setEditing(null)}>Annuler</button>
              <button type="submit" className="btn-primary">Enregistrer</button>
            </div>
          </form>
        </div>
      )}

      {revealPassword && (
        <div className="modal-overlay" onClick={() => setRevealPassword(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Identifiants pour {revealName}</h2>
            <p className="stat-helper">
              Communiquez ce mot de passe temporaire à l'utilisateur — il devra le changer à sa
              première connexion. Il ne sera plus affiché ensuite.
            </p>
            <div className="temp-password-box">
              <code>{revealPassword}</code>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => navigator.clipboard.writeText(revealPassword)}
              >
                <Copy size={14} /> Copier
              </button>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-primary" onClick={() => setRevealPassword(null)}>
                J'ai noté le mot de passe
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
