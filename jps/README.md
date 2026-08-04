# JPS DIEU MERCI — Outil de gestion

Remplace la saisie manuelle dans 4 fichiers Excel (facturation, transport,
distribution/abonnements, suivi de paiements) par une application unique :
Express + Drizzle ORM + PostgreSQL côté serveur, React (Vite) côté client.

Voir `docs/modele-donnees.md` pour le détail du modèle de données et son
équivalence avec les anciens classeurs Excel.

## Démarrage (développement local)

Prérequis : Node.js, pnpm, Docker.

```bash
# 1. Installer les dépendances (à la racine, pnpm gère le monorepo)
pnpm install

# 2. Démarrer PostgreSQL
docker compose up -d

# 3. Créer les tables + les vues + les données de référence
pnpm --filter jps-server db:push
pnpm --filter jps-server db:seed

# 4. Lancer le serveur API (port 4000) et le client (port 5173) dans deux terminaux
pnpm dev:server
pnpm dev:client
```

Ouvrir http://localhost:5173

## Authentification & rôles

`pnpm db:seed` crée un compte administrateur initial et affiche son mot de
passe temporaire dans la console (à changer à la première connexion — c'est
imposé par l'application, aucune autre page n'est accessible tant que ce n'est
pas fait). Ce compte permet ensuite de créer les autres utilisateurs depuis
Administration → Utilisateurs.

Chaque nouvel utilisateur reçoit un mot de passe temporaire à usage unique
(affiché une seule fois à l'écran) — communiquez-le à la personne concernée ;
il devra le changer dès sa première connexion.

Cinq rôles, appliqués et vérifiés côté serveur (`server/src/auth/permissions.ts`) :

| Rôle | Accès |
|---|---|
| Administrateur | Tout, y compris la gestion des utilisateurs |
| Gestionnaire | Tous les modules métier, pas la gestion des utilisateurs |
| Comptable | Facturation, trésorerie, personnel en écriture ; transport/locations/distribution en lecture |
| Caissier | Trésorerie et distribution en écriture ; le reste en lecture, personnel inaccessible |
| Lecture seule | Tout en lecture uniquement |

La barre latérale masque les sections inaccessibles et désactive les actions
d'écriture selon le rôle — mais c'est le serveur qui refuse réellement (403)
toute tentative en dehors de ces droits, pas seulement l'interface.

## Structure

- `db/schema.sql` — schéma PostgreSQL de référence (documentation/validation).
- `server/` — API Express + schéma Drizzle ORM (`server/src/db/schema.ts`).
- `client/` — interface React (un module par activité + tableau de bord).
- `docs/modele-donnees.md` — mapping Excel → base de données.

## Avant la mise en production

- Renseigner une ligne dans `stock_initial` (stock de départ du réseau de
  distribution) — sans cela, le solde de stock du tableau de bord reste vide.
- Importer les données réelles des 4 fichiers Excel (clients, catalogue de
  services, grille tarifaire, distributeurs, historique des factures) —
  aucun script d'import n'a encore été écrit.
- Définir un `JWT_SECRET` propre à la production (voir `server/.env.example`)
  et déployer client+serveur derrière HTTPS pour que le cookie de session
  (`secure: true` en production) fonctionne correctement.
