# Modèle de données JPS DIEU MERCI

Ce document explique le passage des 4 classeurs Excel actuels vers la structure de
base de données définie dans `db/schema.sql` (PostgreSQL, testée sur Postgres 16).

## Activités couvertes

| Activité | Source Excel actuelle | Tables |
|---|---|---|
| Facturation clients | `FACTURIER FREE OK.xlsx` (Base clients, Base produits, Base facturation, FACTURE, PROFORMA, Chiffre affaires) | `clients`, `services`, `factures`, `lignes_facture`, `encaissements` |
| Transport de marchandises | `GRILLE TARIFAIRE TRANSPORT JPS.xlsx` | `tarifs_transport`, `lignes_facture` (référence `tarif_transport_id`) |
| Location d'entrepôt | Texte libre dans "Base produits" (ex "LOCATION ENTREPOT CANAL+") | `contrats_location` (type=ENTREPOT) |
| Location de véhicule | Non présent dans les fichiers — activité déclarée par le client | `contrats_location` (type=VEHICULE), `vehicules` |
| Fourniture de service divers | Texte libre dans "Base produits" (manutention, stationnement, antenniste, cadenas...) | `services` (categorie=SERVICE_DIVERS / MANUTENTION_STATIONNEMENT) |
| Distribution / crédit d'abonnements | `JOURNAL OPERATION OK 1_8-2026.xlsx` (Feuil2 = liste distributeurs, JOURNAL DES OPERATIONS, Feuil1 + SYTHESE JOURNALIER = caisse quotidienne) | `distributeurs`, `operations_distribution`, `stock_initial` |
| Suivi factures à rembourser / notes de frais | `SUIVI FACTURATION JPS ALL.xlsx` | `factures_a_rembourser` |
| Dépenses personnel | Mentionné dans SUIVI FACTURATION ("Paiement salaire VAD") — activité déclarée par le client | `employes`, `depenses_personnel` |
| Dépenses de fonctionnement bureau | Non présent — activité déclarée par le client | `depenses_fonctionnement` |
| Trésorerie / caisse multi-canaux | `Feuil1` + `SYTHESE JOURNALIER` (recalculées à la main chaque jour) | `mouvements_caisse` + vue `v_synthese_journaliere` |

## Ce que la nouvelle structure élimine

1. **Les colonnes ajoutées chaque jour.** `Base facturation` a une colonne par facture
   (1005 colonnes), `SYTHESE JOURNALIER` une paire CDF/USD par jour. Dans le nouveau
   modèle, chaque facture / chaque mouvement de caisse est une **ligne**, pas une
   colonne — la saisie n'a plus de limite et rien ne doit être recopié.
2. **Le calcul manuel du solde de stock.** `H5='=$H$3+...'` (stock actuel) devient la
   vue `v_solde_stock_distribution`, recalculée automatiquement à chaque insertion
   d'opération.
3. **Le chiffre d'affaires mensuel recopié à la main** (onglet "Chiffre affaires",
   formules `SUMIF` sur toute la largeur de `Base facturation`) devient la vue
   `v_chiffre_affaires_mensuel`.
4. **Les VLOOKUP fragiles** entre "Base clients", "Base produits" et "Base facturation"
   deviennent des clés étrangères (`client_id`, `service_id`) garanties par la base.

## Points ouverts à valider avec le client

- **Devise de référence** : les documents mélangent CDF et USD ligne par ligne (parfois
  avec un taux implicite ex `2350`, `2400`). Le schéma stocke le montant + la devise
  telle que saisie, sans conversion automatique — à confirmer si un taux de change
  quotidien doit être ajouté (table `taux_change` facile à greffer si besoin).
- **Location véhicule / dépenses bureau** : aucune donnée historique n'existe dans les
  fichiers fournis ; les tables sont prêtes mais vides — à peupler avec le client.
- **Distributeurs "DA Non trouvé"** : plusieurs `NUMDIST` dans le journal ne correspondent
  à aucune fiche dans la liste des distributeurs. À nettoyer avant migration.
