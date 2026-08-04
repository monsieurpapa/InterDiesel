-- Vues de synthèse — appliquées après le push Drizzle (drizzle-kit ne gère pas les vues).
-- Voir docs/modele-donnees.md pour l'équivalence avec les feuilles Excel remplacées.

create or replace view v_synthese_journaliere as
select
    date_mouvement,
    canal_paiement_id,
    devise,
    sum(case when sens = 'ENTREE' then montant else 0 end)  as total_entrees,
    sum(case when sens = 'SORTIE' then montant else 0 end)  as total_sorties,
    sum(case when sens = 'ENTREE' then montant else -montant end) as solde_net
from mouvements_caisse
group by date_mouvement, canal_paiement_id, devise;

create or replace view v_solde_stock_distribution as
select
    (select montant from stock_initial order by date_reference desc limit 1)
    + coalesce(sum(montant_approvisionnement), 0)
    - coalesce(sum(montant_creditation), 0) as stock_actuel
from operations_distribution;

create or replace view v_chiffre_affaires_mensuel as
select
    date_trunc('month', f.date_facture)::date as mois,
    f.devise,
    sum(lf.montant_ht * (1 - f.remise_pct)) as chiffre_affaires_ht
from factures f
join lignes_facture lf on lf.facture_id = f.id
where f.type = 'FACTURE' and f.statut <> 'ANNULEE'
group by 1, 2;
