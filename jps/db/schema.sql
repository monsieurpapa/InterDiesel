-- ============================================================================
-- JPS DIEU MERCI — Modèle de données unifié
-- Couvre : facturation clients, transport, location entrepôt/véhicule,
-- distribution/crédit d'abonnements (réseau de distributeurs), dépenses
-- (personnel + fonctionnement bureau), trésorerie/caisse multi-canaux.
-- PostgreSQL (Supabase). Identifiants en français pour coller au vocabulaire
-- métier des documents sources.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 0. ENTREPRISE (une seule ligne — infos JPS DIEU MERCI, "Vos données")
-- ----------------------------------------------------------------------------
create table entreprise (
    id                  uuid primary key default gen_random_uuid(),
    nom                 text not null,
    adresse             text,
    ville               text,
    telephone           text,
    n_impot             text,
    id_national         text,
    rccm                text,
    coordonnees_bancaires text,
    taux_tva_defaut     numeric(5,4) not null default 0.16
);

-- ----------------------------------------------------------------------------
-- 1. RÉFÉRENTIELS
-- ----------------------------------------------------------------------------
create table canaux_paiement (
    id      smallint primary key generated always as identity,
    code    text not null unique,         -- MPESA, CASH, AIRTELMONEY, ORANGEMONEY, EQUITY, TMB, RAWBANK, CADECO, VIREMENT, CHEQUE, CARTE
    libelle text not null
);

create table categories_activite (
    id      smallint primary key generated always as identity,
    code    text not null unique,         -- TRANSPORT, LOCATION_ENTREPOT, LOCATION_VEHICULE, SERVICE_DIVERS,
                                            -- ABONNEMENT_DISTRIBUTION, MANUTENTION_STATIONNEMENT, COMMISSION, AUTRE
    libelle text not null
);

create table employes (
    id              uuid primary key default gen_random_uuid(),
    nom             text not null,
    poste           text,
    ville_affectation text,
    telephone       text,
    date_embauche   date,
    actif           boolean not null default true
);

-- ----------------------------------------------------------------------------
-- 2. TIERS
-- ----------------------------------------------------------------------------
create table clients (
    id          uuid primary key default gen_random_uuid(),
    code        text unique,               -- ex C00001, conservé pour compatibilité avec l'historique
    type        text,                       -- SOCIETE, ONG, AGENCE_UN, PARTICULIER...
    nom         text not null,
    adresse     text,
    ville       text,
    telephone   text,
    email       text,
    n_impot     text,
    id_national text,
    rccm        text,
    remarques   text,
    cree_le     timestamptz not null default now()
);

create table distributeurs (
    id                  uuid primary key default gen_random_uuid(),
    numero_dist         bigint not null unique,   -- NUMDIST
    nom_point_vente     text not null,             -- NOM_DIST, ex "KISANGANI - SHOP ESCALIER"
    ville               text,
    statut_defaut       text not null default 'COMPTANT' check (statut_defaut in ('COMPTANT','CREDIT')),
    canal_paiement_id   smallint references canaux_paiement(id),
    actif               boolean not null default true
);

-- ----------------------------------------------------------------------------
-- 3. CATALOGUE & TARIFICATION (unifie "Base produits" + "grille tarifaire transport")
-- ----------------------------------------------------------------------------
create table services (
    id              uuid primary key default gen_random_uuid(),
    reference       text unique,             -- ex P0001
    categorie_id    smallint not null references categories_activite(id),
    description     text not null,
    prix_unitaire   numeric(18,2),
    devise          text not null default 'CDF' check (devise in ('CDF','USD')),
    taux_tva        numeric(5,4) not null default 0,
    cout_achat      numeric(18,2) default 0,
    actif           boolean not null default true
);

-- destinations de transport avec tarif dédié (au lieu d'une ligne "service" par trajet)
create table tarifs_transport (
    id                  uuid primary key default gen_random_uuid(),
    ville_depart        text not null default 'BUNIA',
    ville_arrivee       text not null,
    prix_forfait_100    numeric(18,2) not null,   -- "PRIX HT 100%"
    prix_forfait_50     numeric(18,2) generated always as (prix_forfait_100 / 2) stored,
    prix_par_kg         numeric(18,2),             -- utilisé quand la facturation est au poids (cf factures "de 9000 Kgs")
    devise              text not null default 'CDF' check (devise in ('CDF','USD')),
    actif               boolean not null default true,
    unique (ville_depart, ville_arrivee)
);

-- ----------------------------------------------------------------------------
-- 4. CONTRATS DE LOCATION (entrepôt / véhicule) — LOCATION ENTREPOT & LOCATION VEHICULE
-- ----------------------------------------------------------------------------
create table vehicules (
    id              uuid primary key default gen_random_uuid(),
    immatriculation text unique,
    type_vehicule   text,                       -- camion, bus, voiture...
    proprietaire    text not null default 'JPS' check (proprietaire in ('JPS','TIERS')),
    actif           boolean not null default true
);

create table contrats_location (
    id                  uuid primary key default gen_random_uuid(),
    type                text not null check (type in ('ENTREPOT','VEHICULE')),
    client_id           uuid not null references clients(id),
    vehicule_id         uuid references vehicules(id),   -- renseigné si type = VEHICULE
    objet               text not null,                    -- ex "Location entrepôt CANAL+"
    ville               text,
    date_debut          date not null,
    date_fin            date,
    montant_periodique  numeric(18,2) not null,
    periodicite         text not null default 'MENSUEL' check (periodicite in ('MENSUEL','TRIMESTRIEL','ANNUEL','FORFAIT_UNIQUE')),
    devise              text not null default 'USD' check (devise in ('CDF','USD')),
    statut              text not null default 'ACTIF' check (statut in ('ACTIF','TERMINE','RESILIE'))
);

-- ----------------------------------------------------------------------------
-- 5. FACTURATION (remplace les colonnes "Base facturation" / "FACTURE" / "PROFORMA")
-- ----------------------------------------------------------------------------
create table factures (
    id                  uuid primary key default gen_random_uuid(),
    numero              text not null unique,        -- F00024...
    type                text not null default 'FACTURE' check (type in ('FACTURE','PROFORMA')),
    client_id           uuid not null references clients(id),
    date_facture        date not null,
    date_echeance       date,
    moyen_reglement_id  smallint references canaux_paiement(id),
    remise_pct          numeric(5,4) not null default 0,
    devise              text not null default 'CDF' check (devise in ('CDF','USD')),
    statut              text not null default 'BROUILLON'
                        check (statut in ('BROUILLON','EMISE','PAYEE','PARTIELLEMENT_PAYEE','ANNULEE')),
    cree_le             timestamptz not null default now()
);

create table lignes_facture (
    id              uuid primary key default gen_random_uuid(),
    facture_id      uuid not null references factures(id) on delete cascade,
    service_id      uuid references services(id),
    tarif_transport_id uuid references tarifs_transport(id),
    description     text not null,          -- libre, au cas où hors catalogue (ex détail poids/kg)
    quantite        numeric(18,3) not null default 1,
    prix_unitaire   numeric(18,2) not null,
    taux_tva        numeric(5,4) not null default 0,
    montant_ht      numeric(18,2) generated always as (quantite * prix_unitaire) stored
);

create table encaissements (
    id                  uuid primary key default gen_random_uuid(),
    facture_id          uuid not null references factures(id),
    date_encaissement   date not null,
    montant             numeric(18,2) not null,
    devise              text not null check (devise in ('CDF','USD')),
    canal_paiement_id   smallint references canaux_paiement(id),
    reference_paiement  text
);

-- ----------------------------------------------------------------------------
-- 6. SUIVI DES FACTURES/NOTES DE FRAIS À REMBOURSER ("SUIVI FACTURATION JPS ALL")
-- ----------------------------------------------------------------------------
create table factures_a_rembourser (
    id                      uuid primary key default gen_random_uuid(),
    date_facture            date,
    date_envoi              date,
    nature_operation        text not null,
    numero_facture_externe  text,             -- ex FC/CD02016040/1-78/2026
    numero_bdc              text,             -- ex 4100058631
    montant                 numeric(18,2) not null,
    devise                  text not null check (devise in ('CDF','USD')),
    statut                  text not null default 'A_COMPTABILISER'
                            check (statut in ('A_COMPTABILISER','ATTENTE_BDC','NON_PAYE','PAYE')),
    observation             text
);

-- ----------------------------------------------------------------------------
-- 7. DISTRIBUTION / CRÉDIT D'ABONNEMENTS ("JOURNAL DES OPERATIONS")
--    Remplace le classeur où chaque jour ajoute des lignes ET des colonnes.
-- ----------------------------------------------------------------------------
create table operations_distribution (
    id                          uuid primary key default gen_random_uuid(),
    date_operation              date not null,
    distributeur_id             uuid references distributeurs(id),
    type_operation              text not null check (type_operation in ('CREDITATION','APPROVISIONNEMENT','AUTRE')),
    description                 text,                 -- ex "CREDITATION REABONNEMENT", "Approvisionnement compte principal"
    canal_paiement_id           smallint not null references canaux_paiement(id),
    montant_creditation         numeric(18,2) not null default 0,
    montant_approvisionnement   numeric(18,2) not null default 0,
    statut                      text not null default 'COMPTANT' check (statut in ('COMPTANT','CREDIT')),
    responsable_id              uuid references employes(id),
    devise                      text not null default 'CDF' check (devise in ('CDF','USD'))
);

-- Stock initial de référence, utilisé par la vue de solde ci-dessous.
create table stock_initial (
    id              smallint primary key generated always as identity,
    date_reference  date not null,
    montant         numeric(18,2) not null,
    devise          text not null check (devise in ('CDF','USD'))
);

-- ----------------------------------------------------------------------------
-- 8. DÉPENSES
-- ----------------------------------------------------------------------------
create table depenses_personnel (
    id              uuid primary key default gen_random_uuid(),
    employe_id      uuid not null references employes(id),
    type_depense    text not null check (type_depense in ('SALAIRE','AVANCE','PRIME','AUTRE')),
    mois_concerne   date not null,           -- 1er du mois concerné, ex 2026-05-01 pour "Mai 2026"
    montant         numeric(18,2) not null,
    devise          text not null check (devise in ('CDF','USD')),
    date_paiement   date,
    statut          text not null default 'NON_PAYE' check (statut in ('NON_PAYE','PAYE')),
    observation     text
);

create table depenses_fonctionnement (
    id              uuid primary key default gen_random_uuid(),
    categorie       text not null,           -- LOYER_BUREAU, ELECTRICITE, INTERNET, FOURNITURES, CARBURANT, ENTRETIEN, AUTRE
    montant         numeric(18,2) not null,
    devise          text not null check (devise in ('CDF','USD')),
    date_depense    date not null,
    fournisseur     text,
    justificatif_url text,
    observation     text
);

-- ----------------------------------------------------------------------------
-- 9. CAISSE / TRÉSORERIE UNIFIÉE (remplace "Feuil1" + "SYTHESE JOURNALIER")
--    Toutes les entrées/sorties par canal de paiement passent ici — la synthèse
--    journalière/mensuelle devient une requête (vue), plus une saisie manuelle.
-- ----------------------------------------------------------------------------
create table mouvements_caisse (
    id              uuid primary key default gen_random_uuid(),
    date_mouvement  date not null,
    canal_paiement_id smallint not null references canaux_paiement(id),
    sens            text not null check (sens in ('ENTREE','SORTIE')),
    montant         numeric(18,2) not null,
    devise          text not null check (devise in ('CDF','USD')),
    source_type     text not null check (source_type in ('FACTURE','OPERATION_DISTRIBUTION','DEPENSE_PERSONNEL','DEPENSE_FONCTIONNEMENT','AUTRE')),
    source_id       uuid,                    -- référence libre vers la table source (facture, operation, dépense...)
    observation     text
);

-- ============================================================================
-- VUES — remplacent les feuilles récapitulatives recalculées à la main
-- ============================================================================

-- Synthèse quotidienne par canal (équivalent de "SYTHESE JOURNALIER", sans ajout de colonnes)
create view v_synthese_journaliere as
select
    date_mouvement,
    canal_paiement_id,
    devise,
    sum(case when sens = 'ENTREE' then montant else 0 end)  as total_entrees,
    sum(case when sens = 'SORTIE' then montant else 0 end)  as total_sorties,
    sum(case when sens = 'ENTREE' then montant else -montant end) as solde_net
from mouvements_caisse
group by date_mouvement, canal_paiement_id, devise;

-- Solde de stock du réseau de distribution (équivalent de "STOCK ACTUEL")
create view v_solde_stock_distribution as
select
    (select montant from stock_initial order by date_reference desc limit 1)
    + coalesce(sum(montant_approvisionnement), 0)
    - coalesce(sum(montant_creditation), 0) as stock_actuel
from operations_distribution;

-- Chiffre d'affaires mensuel (équivalent de l'onglet "Chiffre affaires")
create view v_chiffre_affaires_mensuel as
select
    date_trunc('month', f.date_facture)::date as mois,
    f.devise,
    sum(lf.montant_ht * (1 - f.remise_pct)) as chiffre_affaires_ht
from factures f
join lignes_facture lf on lf.facture_id = f.id
where f.type = 'FACTURE' and f.statut <> 'ANNULEE'
group by 1, 2;

-- ============================================================================
-- DONNÉES DE RÉFÉRENCE INITIALES
-- ============================================================================
insert into canaux_paiement (code, libelle) values
    ('CASH','Espèces'), ('MPESA','M-Pesa'), ('AIRTELMONEY','Airtel Money'),
    ('ORANGEMONEY','Orange Money'), ('EQUITY','Equity BCDC'), ('TMB','Trust Merchant Bank'),
    ('RAWBANK','Rawbank'), ('CADECO','Cadeco'), ('VIREMENT','Virement bancaire'),
    ('CHEQUE','Chèque'), ('CARTE','Carte bancaire');

insert into categories_activite (code, libelle) values
    ('TRANSPORT','Transport de marchandises'),
    ('LOCATION_ENTREPOT','Location d''entrepôt'),
    ('LOCATION_VEHICULE','Location de véhicule'),
    ('SERVICE_DIVERS','Fourniture de service divers'),
    ('ABONNEMENT_DISTRIBUTION','Distribution / crédit d''abonnements'),
    ('MANUTENTION_STATIONNEMENT','Manutention et stationnement'),
    ('COMMISSION','Commissionnement'),
    ('AUTRE','Autre');
