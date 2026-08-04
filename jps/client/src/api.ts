const API = "/api";

export const ERROR_LABELS: Record<string, string> = {
  NON_AUTHENTIFIE: "Votre session a expiré, reconnectez-vous.",
  ACCES_REFUSE: "Vous n'avez pas les droits nécessaires pour cette action.",
  MOT_DE_PASSE_A_CHANGER: "Vous devez d'abord changer votre mot de passe.",
  IDENTIFIANTS_INVALIDES: "E-mail ou mot de passe incorrect.",
  TROP_DE_TENTATIVES: "Trop de tentatives, réessayez dans quelques minutes.",
  DERNIER_ADMINISTRATEUR: "Impossible : il doit rester au moins un administrateur actif.",
  MOT_DE_PASSE_ACTUEL_INCORRECT: "Le mot de passe actuel est incorrect.",
  MOT_DE_PASSE_TROP_COURT: "Le nouveau mot de passe doit contenir au moins 8 caractères.",
};

async function handle(res: Response) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const code = body.error;
    throw new Error((code && ERROR_LABELS[code]) || code || `Erreur ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const apiList = (resource: string) =>
  fetch(`${API}/${resource}`, { credentials: "include" }).then(handle);

export const apiGet = (resource: string, id: string) =>
  fetch(`${API}/${resource}/${id}`, { credentials: "include" }).then(handle);

export const apiCreate = (resource: string, data: unknown) =>
  fetch(`${API}/${resource}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(handle);

export const apiUpdate = (resource: string, id: string, data: unknown) =>
  fetch(`${API}/${resource}/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(handle);

export const apiDelete = (resource: string, id: string) =>
  fetch(`${API}/${resource}/${id}`, { method: "DELETE", credentials: "include" }).then(handle);
