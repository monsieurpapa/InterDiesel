import { useState } from "react";
import { Navigate } from "react-router-dom";
import { LogIn } from "lucide-react";
import { useAuth } from "../auth/AuthContext";

export function Login() {
  const { login, user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (user) {
    return <Navigate to={user.doitChangerMotDePasse ? "/changer-mot-de-passe" : "/"} replace />;
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="sidebar-brand-mark auth-mark">JPS</div>
        <h1>JPS DIEU MERCI</h1>
        <p className="auth-subtitle">Connectez-vous à votre espace de gestion</p>

        {error && <div className="error-banner">{error}</div>}

        <label className="form-field">
          <span>E-mail</span>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="form-field">
          <span>Mot de passe</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <button type="submit" className="btn-primary auth-submit" disabled={loading}>
          <LogIn size={16} /> {loading ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
