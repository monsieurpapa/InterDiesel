import type { FieldConfig } from "../components/CrudPage";

const DEVISE_OPTIONS = [
  { value: "CDF", label: "CDF" },
  { value: "USD", label: "USD" },
];

export const clientsFields: FieldConfig[] = [
  { key: "code", label: "Code client", type: "text" },
  { key: "type", label: "Type", type: "text" },
  { key: "nom", label: "Nom / Raison sociale", type: "text", required: true },
  { key: "adresse", label: "Adresse", type: "text" },
  { key: "ville", label: "Ville", type: "text" },
  { key: "telephone", label: "Téléphone", type: "text" },
  { key: "email", label: "E-mail", type: "text" },
  { key: "nImpot", label: "N° Impôt", type: "text" },
  { key: "idNational", label: "ID National", type: "text" },
  { key: "rccm", label: "RCCM", type: "text" },
  { key: "remarques", label: "Remarques", type: "textarea" },
];

export const servicesFields: FieldConfig[] = [
  { key: "reference", label: "Référence", type: "text" },
  {
    key: "categorieId",
    label: "Catégorie d'activité",
    type: "select",
    required: true,
    optionsResource: "categories-activite",
    optionsLabelKey: "libelle",
  },
  { key: "description", label: "Description", type: "text", required: true },
  { key: "prixUnitaire", label: "Prix unitaire", type: "number" },
  { key: "devise", label: "Devise", type: "select", staticOptions: DEVISE_OPTIONS, defaultValue: "CDF" },
  { key: "tauxTva", label: "Taux TVA", type: "number", defaultValue: 0 },
  { key: "coutAchat", label: "Coût d'achat", type: "number", defaultValue: 0 },
  { key: "actif", label: "Actif", type: "checkbox", defaultValue: true },
];

export const tarifsTransportFields: FieldConfig[] = [
  { key: "villeDepart", label: "Ville de départ", type: "text", required: true, defaultValue: "BUNIA" },
  { key: "villeArrivee", label: "Ville d'arrivée", type: "text", required: true },
  { key: "prixForfait100", label: "Prix forfait 100%", type: "number", required: true },
  { key: "prixParKg", label: "Prix par kg", type: "number" },
  { key: "devise", label: "Devise", type: "select", staticOptions: DEVISE_OPTIONS, defaultValue: "CDF" },
  { key: "actif", label: "Actif", type: "checkbox", defaultValue: true },
];

export const vehiculesFields: FieldConfig[] = [
  { key: "immatriculation", label: "Immatriculation", type: "text" },
  { key: "typeVehicule", label: "Type de véhicule", type: "text" },
  {
    key: "proprietaire",
    label: "Propriétaire",
    type: "select",
    staticOptions: [
      { value: "JPS", label: "JPS (véhicule propre)" },
      { value: "TIERS", label: "Tiers (loué)" },
    ],
    defaultValue: "JPS",
  },
  { key: "actif", label: "Actif", type: "checkbox", defaultValue: true },
];

export const contratsLocationFields: FieldConfig[] = [
  {
    key: "type",
    label: "Type de contrat",
    type: "select",
    required: true,
    staticOptions: [
      { value: "ENTREPOT", label: "Location d'entrepôt" },
      { value: "VEHICULE", label: "Location de véhicule" },
    ],
  },
  { key: "clientId", label: "Client", type: "select", required: true, optionsResource: "clients", optionsLabelKey: "nom" },
  { key: "vehiculeId", label: "Véhicule (si location véhicule)", type: "select", optionsResource: "vehicules", optionsLabelKey: "immatriculation" },
  { key: "objet", label: "Objet du contrat", type: "text", required: true },
  { key: "ville", label: "Ville", type: "text" },
  { key: "dateDebut", label: "Date de début", type: "date", required: true },
  { key: "dateFin", label: "Date de fin", type: "date" },
  { key: "montantPeriodique", label: "Montant périodique", type: "number", required: true },
  {
    key: "periodicite",
    label: "Périodicité",
    type: "select",
    defaultValue: "MENSUEL",
    staticOptions: [
      { value: "MENSUEL", label: "Mensuel" },
      { value: "TRIMESTRIEL", label: "Trimestriel" },
      { value: "ANNUEL", label: "Annuel" },
      { value: "FORFAIT_UNIQUE", label: "Forfait unique" },
    ],
  },
  { key: "devise", label: "Devise", type: "select", staticOptions: DEVISE_OPTIONS, defaultValue: "USD" },
  {
    key: "statut",
    label: "Statut",
    type: "select",
    defaultValue: "ACTIF",
    staticOptions: [
      { value: "ACTIF", label: "Actif" },
      { value: "TERMINE", label: "Terminé" },
      { value: "RESILIE", label: "Résilié" },
    ],
  },
];

export const distributeursFields: FieldConfig[] = [
  { key: "numeroDist", label: "Numéro distributeur", type: "number", required: true },
  { key: "nomPointVente", label: "Nom du point de vente", type: "text", required: true },
  { key: "ville", label: "Ville", type: "text" },
  {
    key: "statutDefaut",
    label: "Statut par défaut",
    type: "select",
    defaultValue: "COMPTANT",
    staticOptions: [
      { value: "COMPTANT", label: "Comptant" },
      { value: "CREDIT", label: "Crédit" },
    ],
  },
  { key: "canalPaiementId", label: "Canal de paiement habituel", type: "select", optionsResource: "canaux-paiement", optionsLabelKey: "libelle" },
  { key: "actif", label: "Actif", type: "checkbox", defaultValue: true },
];

export const operationsDistributionFields: FieldConfig[] = [
  { key: "dateOperation", label: "Date", type: "date", required: true },
  { key: "distributeurId", label: "Distributeur", type: "select", optionsResource: "distributeurs", optionsLabelKey: "nomPointVente" },
  {
    key: "typeOperation",
    label: "Type d'opération",
    type: "select",
    required: true,
    staticOptions: [
      { value: "CREDITATION", label: "Créditation" },
      { value: "APPROVISIONNEMENT", label: "Approvisionnement" },
      { value: "AUTRE", label: "Autre" },
    ],
  },
  { key: "description", label: "Description", type: "text" },
  { key: "canalPaiementId", label: "Canal de paiement", type: "select", required: true, optionsResource: "canaux-paiement", optionsLabelKey: "libelle" },
  { key: "montantCreditation", label: "Montant créditation", type: "number", defaultValue: 0 },
  { key: "montantApprovisionnement", label: "Montant approvisionnement", type: "number", defaultValue: 0 },
  {
    key: "statut",
    label: "Statut",
    type: "select",
    defaultValue: "COMPTANT",
    staticOptions: [
      { value: "COMPTANT", label: "Comptant" },
      { value: "CREDIT", label: "Crédit" },
    ],
  },
  { key: "responsableId", label: "Responsable", type: "select", optionsResource: "employes", optionsLabelKey: "nom" },
  { key: "devise", label: "Devise", type: "select", staticOptions: DEVISE_OPTIONS, defaultValue: "CDF" },
];

export const facturesARembourserFields: FieldConfig[] = [
  { key: "dateFacture", label: "Date facture", type: "date" },
  { key: "dateEnvoi", label: "Date d'envoi", type: "date" },
  { key: "natureOperation", label: "Nature de l'opération", type: "text", required: true },
  { key: "numeroFactureExterne", label: "N° facture", type: "text" },
  { key: "numeroBdc", label: "N° BDC", type: "text" },
  { key: "montant", label: "Montant", type: "number", required: true },
  { key: "devise", label: "Devise", type: "select", required: true, staticOptions: DEVISE_OPTIONS },
  {
    key: "statut",
    label: "Statut",
    type: "select",
    defaultValue: "A_COMPTABILISER",
    staticOptions: [
      { value: "A_COMPTABILISER", label: "À comptabiliser" },
      { value: "ATTENTE_BDC", label: "Attente BDC" },
      { value: "NON_PAYE", label: "Non payé" },
      { value: "PAYE", label: "Payé" },
    ],
  },
  { key: "observation", label: "Observation", type: "textarea" },
];

export const employesFields: FieldConfig[] = [
  { key: "nom", label: "Nom", type: "text", required: true },
  { key: "poste", label: "Poste", type: "text" },
  { key: "villeAffectation", label: "Ville d'affectation", type: "text" },
  { key: "telephone", label: "Téléphone", type: "text" },
  { key: "dateEmbauche", label: "Date d'embauche", type: "date" },
  { key: "actif", label: "Actif", type: "checkbox", defaultValue: true },
];

export const depensesPersonnelFields: FieldConfig[] = [
  { key: "employeId", label: "Employé", type: "select", required: true, optionsResource: "employes", optionsLabelKey: "nom" },
  {
    key: "typeDepense",
    label: "Type de dépense",
    type: "select",
    required: true,
    staticOptions: [
      { value: "SALAIRE", label: "Salaire" },
      { value: "AVANCE", label: "Avance" },
      { value: "PRIME", label: "Prime" },
      { value: "AUTRE", label: "Autre" },
    ],
  },
  { key: "moisConcerne", label: "Mois concerné", type: "date", required: true },
  { key: "montant", label: "Montant", type: "number", required: true },
  { key: "devise", label: "Devise", type: "select", required: true, staticOptions: DEVISE_OPTIONS },
  { key: "datePaiement", label: "Date de paiement", type: "date" },
  {
    key: "statut",
    label: "Statut",
    type: "select",
    defaultValue: "NON_PAYE",
    staticOptions: [
      { value: "NON_PAYE", label: "Non payé" },
      { value: "PAYE", label: "Payé" },
    ],
  },
  { key: "observation", label: "Observation", type: "textarea" },
];

export const depensesFonctionnementFields: FieldConfig[] = [
  {
    key: "categorie",
    label: "Catégorie",
    type: "select",
    required: true,
    staticOptions: [
      { value: "LOYER_BUREAU", label: "Loyer bureau" },
      { value: "ELECTRICITE", label: "Électricité" },
      { value: "INTERNET", label: "Internet" },
      { value: "FOURNITURES", label: "Fournitures" },
      { value: "CARBURANT", label: "Carburant" },
      { value: "ENTRETIEN", label: "Entretien" },
      { value: "AUTRE", label: "Autre" },
    ],
  },
  { key: "montant", label: "Montant", type: "number", required: true },
  { key: "devise", label: "Devise", type: "select", required: true, staticOptions: DEVISE_OPTIONS },
  { key: "dateDepense", label: "Date", type: "date", required: true },
  { key: "fournisseur", label: "Fournisseur", type: "text" },
  { key: "justificatifUrl", label: "Justificatif (URL)", type: "text" },
  { key: "observation", label: "Observation", type: "textarea" },
];

export const mouvementsCaisseFields: FieldConfig[] = [
  { key: "dateMouvement", label: "Date", type: "date", required: true },
  { key: "canalPaiementId", label: "Canal de paiement", type: "select", required: true, optionsResource: "canaux-paiement", optionsLabelKey: "libelle" },
  {
    key: "sens",
    label: "Sens",
    type: "select",
    required: true,
    staticOptions: [
      { value: "ENTREE", label: "Entrée" },
      { value: "SORTIE", label: "Sortie" },
    ],
  },
  { key: "montant", label: "Montant", type: "number", required: true },
  { key: "devise", label: "Devise", type: "select", required: true, staticOptions: DEVISE_OPTIONS },
  {
    key: "sourceType",
    label: "Origine",
    type: "select",
    defaultValue: "AUTRE",
    staticOptions: [
      { value: "FACTURE", label: "Facture" },
      { value: "OPERATION_DISTRIBUTION", label: "Opération de distribution" },
      { value: "DEPENSE_PERSONNEL", label: "Dépense personnel" },
      { value: "DEPENSE_FONCTIONNEMENT", label: "Dépense de fonctionnement" },
      { value: "AUTRE", label: "Autre" },
    ],
  },
  { key: "observation", label: "Observation", type: "textarea" },
];
