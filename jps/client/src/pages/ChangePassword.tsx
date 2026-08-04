import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { apiCreate } from "../api";

export function ChangePassword() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Le nouveau mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    setLoading(true);
    try {
      await apiCreate("auth/change-password", { currentPassword, newPassword });
      if (user) setUser({ ...user, doitChangerMotDePasse: false });
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="sidebar-brand-mark auth-mark">JPS</div>
        <h1>Changement de mot de passe</h1>
        <p className="auth-subtitle">
          {user?.doitChangerMotDePasse
            ? "Pour des raisons de sécurité, vous devez définir un nouveau mot de passe avant de continuer."
            : "Définissez un nouveau mot de passe."}
        </p>

        {error && <div className="error-banner">{error}</div>}

        <label className="form-field">
          <span>Mot de passe actuel (temporaire)</span>
          <input
            type="password"
            required
            autoFocus
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </label>
        <label className="form-field">
          <span>Nouveau mot de passe</span>
          <input
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        <label className="form-field">
          <span>Confirmer le nouveau mot de passe</span>
          <input
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>

        <button type="submit" className="btn-primary auth-submit" disabled={loading}>
          <KeyRound size={16} /> {loading ? "Enregistrement…" : "Changer le mot de passe"}
        </button>

        <button type="button" className="auth-logout-link" onClick={() => logout()}>
          Se déconnecter
        </button>
      </form>
    </div>
  );
}
