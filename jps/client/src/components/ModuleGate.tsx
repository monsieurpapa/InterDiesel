import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { canAccess, type Module } from "../config/permissions";

/**
 * Masque une page si le rôle de l'utilisateur n'a pas accès au module.
 * Confort d'affichage seulement — le serveur refuse de toute façon la requête
 * (403 ACCES_REFUSE) si quelqu'un contourne ce garde-fou.
 */
export function ModuleGate({ module, children }: { module: Module; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || canAccess(user.role, module)) {
    return <>{children}</>;
  }
  return (
    <div className="page">
      <div className="auth-denied">
        <ShieldAlert size={28} />
        <h1>Accès non autorisé</h1>
        <p>Votre rôle ({user.roleLabel}) ne donne pas accès à cette section.</p>
      </div>
    </div>
  );
}
