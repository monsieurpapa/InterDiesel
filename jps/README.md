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

## Import des données historiques

`pnpm --filter jps-server db:import-legacy` importe les données **réelles**
extraites des 4 fichiers Excel (voir `server/src/db/legacy-data/*.json`,
générés depuis les classeurs sources — les scripts d'extraction Python ne
sont pas versionnés, seuls les JSON le sont). Important : plusieurs feuilles
Excel contenaient des colonnes pré-remplies par glissement (numéros de
facture, références produit) sans aucune donnée réelle associée — l'import
ne reprend que les lignes effectivement saisies :

| Table | Lignes importées |
|---|---|
| Clients | 3 |
| Services / produits | 32 |
| Tarifs transport | 12 |
| Factures (+ 13 lignes) | 9 |
| Distributeurs | 234 |
| Opérations de distribution | 931 |
| Factures à rembourser | 47 |

Le script est idempotent pour les tables à clé unique (clients, services,
tarifs, distributeurs, factures) mais saute l'import des opérations et
remboursements si la table cible n'est pas vide — pas de doublons en cas de
ré-exécution accidentelle.

**Non importé, à faire manuellement** : les feuilles "Feuil1" et "SYTHESE
JOURNALIER" du journal des opérations sont des récapitulatifs hebdomadaires
recalculés à la main, pas une source de données primaire — elles n'ont pas
été reprises dans `mouvements_caisse`. La caisse se remplit désormais au fil
de l'eau via l'application.

## Avant la mise en production

- Renseigner une ligne dans `stock_initial` (stock de départ du réseau de
  distribution) — sans cela, le solde de stock du tableau de bord reste vide.
- Vérifier la devise des montants dans "factures à rembourser" : au moins une
  ligne importée porte la devise USD alors que le montant source semble déjà
  converti en CDF (incohérence présente dans le fichier Excel d'origine, non
  corrigée automatiquement — voir `docs/questions-client.md`, point 1).
- Définir un `JWT_SECRET` propre à la production (voir `server/.env.example`)
  et déployer client+serveur derrière HTTPS pour que le cookie de session
  (`secure: true` en production) fonctionne correctement.

## Déploiement (Railway)

Un seul service Railway sert à la fois l'API et le client compilé, depuis la
même origine — ça évite d'avoir à gérer des cookies cross-domaine pour la
session (`sameSite: "lax"` suffit).

- Racine du service : `jps/` (le monorepo pnpm). Railway détecte `pnpm-lock.yaml`
  et utilise les scripts `build`/`start` du `package.json` racine :
  - `build` : compile le client (`vite build`) puis le serveur (`tsc`)
  - `start` : lance `node server/dist/index.js`
- `server/src/index.ts` sert `client/dist/` en statique (avec retombée SPA sur
  `index.html` pour les routes non-`/api`) uniquement quand ce dossier existe
  — absent en développement local, où le client tourne séparément sur Vite.
- Variables d'environnement à définir sur le service : `DATABASE_URL`,
  `JWT_SECRET`, `NODE_ENV=production`.

```bash
railway up --detach                    # déployer depuis jps/
railway variable set DATABASE_URL=...  # + JWT_SECRET, NODE_ENV=production
railway domain                         # générer une URL publique
```

URL actuelle : https://jps-production-8473.up.railway.app
