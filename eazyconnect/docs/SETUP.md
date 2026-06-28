# Guide d'installation — EAZY KONNECT

## Prérequis matériels

| Équipement | Modèle | Quantité |
|-----------|--------|----------|
| Backhaul Starlink | Starlink Standard Kit | 1 |
| Antennes sectorielles 2.4 GHz 120° | Hana HW-SA24-16-120-NF ou Ubiquiti AM-2G15-120 | 3 |
| Points d'accès extérieurs | TP-Link Omada EAP225-Outdoor (AC1200, IP65, PoE) | 3 |
| Switch PoE managé 8 ports | TP-Link TL-SG108PE | 1 |
| Routeur / Contrôleur | MikroTik hAP ac² ou RB4011 | 1 |
| Onduleur | CyberPower CP1500AVRLCD (1500 VA) | 1 |
| Parafoudres outdoor | IP-rated surge protectors | 2–3 |
| Câblage | Cat6 outdoor UV + connecteurs étanches | 1 lot |
| Laptop de gestion | Windows 10/11 | 1 |

**Budget matériel estimé : 2 480 – 2 760 USD**

---

## Étape 1 — Installation du serveur EAZY KONNECT

### 1.1 Prérequis logiciels
```bash
# Installer Node.js 18 LTS depuis https://nodejs.org
node --version   # → v18.x ou supérieur

# Cloner / copier le projet
cd C:\eazyconnect

# Installer les dépendances
npm install
```

> **Windows Build Tools** : Si `npm install` échoue sur `better-sqlite3`, ouvrez un terminal admin et exécutez :
> ```
> npm install --global --production windows-build-tools
> ```

### 1.2 Configuration
```bash
# Copier le fichier de config
copy .env.example .env

# Ouvrir .env et modifier :
# ADMIN_PASSWORD=votre_mot_de_passe_secret
# MIKROTIK_HOST=192.168.88.1          (IP de votre MikroTik)
# SERVER_IP=192.168.88.10             (IP de ce laptop sur le LAN)
```

### 1.3 Démarrage
```bash
npm start
```

Le serveur démarre sur `http://localhost:3000`.

---

## Étape 2 — Configuration MikroTik Hotspot

### 2.1 Depuis Winbox (interface graphique)

1. **IP → Hotspot → Setup** (assistant de configuration)
   - Interface : bridge (ou l'interface LAN)
   - IP de l'hotspot : `192.168.88.1/24`
   - Pool DHCP : `192.168.88.100-200`
   - DNS : `8.8.8.8, 8.8.4.4`
   - Login page : laisser par défaut (on va rediriger)

2. **IP → Hotspot → Server Profiles → hsprof1**
   - Login By : `MAC or Name`
   - URL de redirection : `http://192.168.88.10:3000/portal`
     *(remplacez `192.168.88.10` par l'IP réelle du laptop)*

3. Cliquer **OK**

### 2.2 Créer les profils utilisateurs via le dashboard admin

1. Ouvrez `http://localhost:3000/admin`
2. Allez dans **Paramètres**
3. Renseignez l'IP MikroTik, l'utilisateur et le mot de passe
4. Cliquez **Tester la connexion** — doit afficher ✅
5. Cliquez **Créer profils hotspot** — crée les 5 profils `ek-1h`, `ek-3h`, etc.

### 2.3 Vérification via terminal MikroTik (CLI)
```
/ip hotspot user profile print
```
Vous devez voir : `ek-1h`, `ek-3h`, `ek-12h`, `ek-24h`, `ek-7d`

---

## Étape 3 — Configuration réseau radio

### Plan de canaux (éviter les interférences)
```
Secteur A (Azimut 0°  / Nord)     → Canal WiFi 1
Secteur B (Azimut 120° / Sud-Est) → Canal WiFi 6
Secteur C (Azimut 240° / Sud-Ouest)→ Canal WiFi 11
```

### Paramètres AP TP-Link EAP225-Outdoor
Via l'interface Omada Controller ou l'IP de l'AP :
- **SSID** : `EAZY-KONNECT` (identique sur les 3 APs)
- **Bande** : 2.4 GHz uniquement
- **Sécurité** : Ouverte (l'authentification est gérée par le portail captif)
- **VLAN** : Identique sur les 3 APs
- **Puissance TX** : Démarrer à 20 dBm, ajuster selon RSSI terrain

---

## Étape 4 — VLAN MikroTik (recommandé)

```
/interface bridge add name=bridge-clients
/interface vlan add interface=ether2 name=vlan-clients vlan-id=10
/ip address add address=192.168.88.1/24 interface=bridge-clients
```

Segmentation recommandée :
- **VLAN 10** : Clients WiFi (hotspot)
- **VLAN 20** : Gestion / Admin
- **WAN** : Starlink (ether1)

---

## Étape 5 — Protection électrique

1. Brancher TOUS les équipements (Starlink, routeur, switch, APs) sur l'**UPS 1 500 VA**
2. Installer des **parafoudres outdoor** sur chaque câble Cat6 entrant/sortant
3. Mise à la terre de l'antenne Starlink et des mâts (<5 Ω idéalement)
4. Protéger les prises avec des parasurtenseurs intérieurs

---

## Étape 6 — Tests de validation

### 6.1 Test réseau
```bash
# Depuis un PC sur le réseau MikroTik
ping 192.168.88.1       # → MikroTik répond
ping 192.168.88.10      # → Laptop EAZY KONNECT répond
```

### 6.2 Test portail captif
1. Connectez un smartphone au WiFi `EAZY-KONNECT`
2. Ouvrez un navigateur → doit rediriger vers `http://192.168.88.10:3000/portal`
3. Générez un voucher test depuis l'admin
4. Entrez le code sur le portail → vous devez avoir accès Internet
5. Attendez l'expiration → la connexion coupe automatiquement

### 6.3 Test MikroTik
```
# Via terminal MikroTik
/ip hotspot active print
```
Doit lister votre appareil test.

---

## Étape 7 — Maintenance

### Quotidienne
- Vérifier le dashboard admin (sessions actives, revenus)
- Confirmer que l'onduleur est chargé

### Hebdomadaire
- Exporter les rapports de revenus
- Générer de nouveaux lots de vouchers si le stock est faible

### Trimestrielle
- Inspection visuelle des câbles et antennes
- Test de basculement sur UPS
- Mise à jour du firmware MikroTik
- Nettoyage des antennes et connecteurs

---

## Dépannage

| Problème | Cause probable | Solution |
|---------|----------------|----------|
| Le portail ne s'ouvre pas | URL de redirection MikroTik incorrecte | Corriger l'URL dans Server Profiles |
| Code "invalide" sur le portail | Faute de frappe ou code inexistant | Vérifier le code dans le dashboard admin |
| MikroTik "hors ligne" dans l'admin | IP ou port incorrect, API non activée | Activer l'API : `/ip service enable api` |
| Pas d'Internet après connexion | Profil MikroTik non créé | Recliquer "Créer profils hotspot" |
| Déconnexion aléatoire | Coupure Starlink ou UPS épuisé | Vérifier l'UPS, redémarrer Starlink |

---

## Démarrage automatique (Windows)

Pour que le serveur démarre automatiquement avec Windows :

```bash
# Installer PM2
npm install -g pm2

# Démarrer avec PM2
pm2 start server.js --name eazyconnect
pm2 save
pm2 startup
```

---

## Adresses importantes

| Service | Adresse |
|---------|---------|
| Landing page | http://192.168.88.10:3000 |
| Admin dashboard | http://192.168.88.10:3000/admin |
| Portail captif | http://192.168.88.10:3000/portal |
| Impression vouchers | http://192.168.88.10:3000/print/:batchId |
| Interface MikroTik | http://192.168.88.1 |
| API REST | http://192.168.88.10:3000/api |

---

*Copyright EAZY KONNECT 2026 — Tous droits réservés*
