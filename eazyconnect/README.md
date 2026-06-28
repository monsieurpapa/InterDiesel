# EAZY KONNECT — Système de Gestion Vouchers WiFi

Système complet de distribution d'accès Internet par vouchers, propulsé par Starlink, pour les quartiers populaires de Goma, RDC.

## Démarrage rapide

```bash
npm install
cp .env.example .env    # (Windows: copy .env.example .env)
# Modifier .env selon votre configuration
npm start
```

Puis ouvrez :
- **Landing page** → http://localhost:3000
- **Administration** → http://localhost:3000/admin  *(mot de passe : voir .env)*
- **Portail captif** → http://localhost:3000/portal

## Architecture

```
Starlink (WAN)
    ↓
MikroTik Router (192.168.88.1)
    ├── Hotspot + Captive Portal redirect → http://SERVER:3000/portal
    ├── VLAN Clients
    └── Switch PoE
            ├── AP Sectoriel A (Canal 1, azimut 0°)
            ├── AP Sectoriel B (Canal 6, azimut 120°)
            └── AP Sectoriel C (Canal 11, azimut 240°)

Laptop Admin (192.168.88.10:3000)
    ├── Landing page (public)
    ├── Admin dashboard (protégé par mot de passe)
    ├── Portail captif (ouvert, sert les utilisateurs WiFi)
    ├── API REST (/api/*)
    └── SQLite DB (data/eazyconnect.db)
```

## Forfaits

| Forfait | Durée | Prix | Débit |
|---------|-------|------|-------|
| Express | 1h | 200 FC | 2/1 Mbps |
| Standard | 3h | 500 FC | 3/1.5 Mbps |
| Journée | 12h | 1 000 FC | 5/2 Mbps |
| Quotidien | 24h | 2 000 FC | 5/2 Mbps |
| Hebdo | 7 jours | 10 000 FC | 10/5 Mbps |

## Flux utilisateur

```
1. Achetez un voucher chez un distributeur local
2. Connectez-vous au WiFi "EAZY-KONNECT"
3. Ouvrez votre navigateur → portail captif s'affiche
4. Entrez votre code voucher (format: XXXX-XXXX)
5. Connexion accordée pour la durée du forfait
6. À l'expiration → déconnexion automatique
```

## Guide complet

Voir [docs/SETUP.md](docs/SETUP.md) pour l'installation complète (MikroTik, réseau radio, maintenance).

---
*Phase pilote : Quartier Himbi-Alanine, Goma — EAZY KONNECT 2026*
