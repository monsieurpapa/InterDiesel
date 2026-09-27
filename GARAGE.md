# Garage Inter-Diesel : guide rapide

Le garage est un « magasin » de type **Garage** avec sa propre petite étagère de pièces
(huiles, filtres…). Au démarrage du serveur, l'application crée le garage, son équipe par
défaut et le catalogue des travaux s'ils n'existent pas encore.

| Personne | Rôle | PIN de départ |
|---|---|---|
| Jean-Marie Kasongo | Chef d'atelier (gérant) | 7777 |
| Faustin Bahati | Mécanicien | 1234 |
| Josué Amani | Mécanicien | 5678 |
| Nadine Furaha | Réception / caisse (vendeur) | 2468 |

Changez les PIN dans **Menu › Utilisateurs** et donnez un identifiant au chef d'atelier pour
qu'il connecte le téléphone ou l'ordinateur du garage (choisir « Inter-Diesel Garage »).

## Le parcours d'un véhicule

1. **Entrée** (Atelier › Nouvelle entrée) : plaque (un véhicule connu est retrouvé),
   client, kilométrage, carburant, n° d'étiquette des clés, demande du client, objets laissés
   dans le véhicule, dégâts visibles, photos, n° de bon de commande pour les ONG et entreprises.
   La fiche d'entrée s'imprime ou part sur WhatsApp.
2. **Contrôle** : le mécanicien coche chaque point (Bon, À surveiller, À réparer, N/A) avec
   une remarque, puis écrit le diagnostic. Deux mécaniciens peuvent cocher en même temps.
3. **Travaux et pièces** : le chef d'atelier ajoute la main-d'œuvre (catalogue ou texte libre,
   prix modifiables). Les pièces nécessaires sont choisies avec le magasin qui les fournit
   (le stock de chaque magasin est affiché).
   - Pièces de l'étagère du garage : bouton « Sortir de l'étagère du garage ».
   - Pièces d'un magasin : le magasin les voit dans **Menu › Bons de sortie**, prépare le
     **bon de sortie** (le stock du magasin baisse), l'imprime ou l'envoie sur WhatsApp.
     Le garage peut aussi prévenir le magasin sur WhatsApp.
   - Pièces non utilisées : « Rendre des pièces non utilisées » (le stock remonte).
4. **Devis et facture** : devis envoyé sur WhatsApp, puis accord du client enregistré (qui,
   comment, n° de bon de commande). Si le devis dépasse ensuite le montant accepté, la
   réparation est marquée **« À faire ré-approuver »**. La facture se paie comptant, en
   mobile money, à crédit sur le compte du client, ou en mélangeant les modes.
5. **Sortie** : nom de la personne qui reprend le véhicule, kilométrage, **signature sur
   l'écran**, date et kilométrage du prochain entretien.

## Suivi

- **Véhicules** : historique de chaque véhicule ; les clients entreprises et ONG voient
  toute leur flotte sur leur fiche client, avec le **relevé de compte** à envoyer sur WhatsApp.
- **Rappels d'entretien** : véhicules dont l'entretien arrive (14 jours ou 500 km) ou est
  dépassé, avec un bouton pour prévenir le client.
- Les factures du garage entrent dans la **clôture de caisse** du garage et dans les
  **rapports** ; les dettes des clients dans **Clients**.
- Le propriétaire peut annuler un bon de sortie ou une facture (bouton « Annuler cette
  opération »), comme les autres opérations.
