import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

/** Bloque tout accès tant que la session n'est pas valide ET que le mot de
 * passe temporaire a été changé — reflète le même garde-fou côté serveur. */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-screen">
        <p className="stat-helper">Chargement…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/connexion" replace />;
  }

  if (user.doitChangerMotDePasse && location.pathname !== "/changer-mot-de-passe") {
    return <Navigate to="/changer-mot-de-passe" replace />;
  }

  return <Outlet />;
}
