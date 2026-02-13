# VendreFacile – Plateforme de Petites Annonces

## Architecture

```
┌────────────┐      ┌──────────┐      ┌──────┐ ┌──────┐ ┌──────┐
│  Client     │─────▶│  API     │─────▶│ pg-0 │ │ pg-1 │ │ pg-2 │
│ (REST/JSON) │      │ Express  │      │PRIMARY│ │STANDBY│ │STANDBY│
└────────────┘      └────┬─────┘      └──┬───┘ └──┬───┘ └──┬───┘
                         │               │        │        │
                         ▼               └────────┴────────┘
                    ┌──────────┐              Réplication
                    │  Pgpool  │◀── Load balancing + failover
                    └──────────┘
```

- **API** : Node.js / Express (port 3000)
- **Base de données** : PostgreSQL 17 en cluster HA (3 nœuds via repmgr)
- **Pgpool-II** : load-balancing lectures, failover automatique
- **Séparation lecture/écriture** : writes → pgpool (primary), reads → pg-1 (standby)

## Base de données distribuée

| Aspect | Choix |
|---|---|
| **Moteur** | PostgreSQL 17 |
| **Réplication** | Streaming réplication via repmgr (1 primary + 2 standby) |
| **Load balancing** | Pgpool-II répartit les SELECT sur les standby |
| **Failover** | Automatique via repmgr (promotion standby → primary) |
| **Modèle CAP** | CP – Cohérence forte + tolérance au partitionnement |
| **Sharding** | Non nécessaire à ce stade (<10k utilisateurs), extensible via Citus |

## Tables

- `users` – comptes (user/pro/admin), géolocalisation
- `categories` – arbre de catégories
- `annonces` – petites annonces avec prix, lieu, coordonnées GPS
- `annonce_images` – images liées aux annonces
- `favorites` – favoris utilisateur
- `conversations` – fils de discussion par annonce
- `messages` – messages dans les conversations

## API Endpoints

| Méthode | Route | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/register` | ✗ | Inscription |
| POST | `/api/auth/login` | ✗ | Connexion (JWT) |
| GET | `/api/profile` | ✓ | Mon profil |
| PUT | `/api/profile` | ✓ | Modifier profil |
| GET | `/api/categories` | ✗ | Liste catégories |
| GET | `/api/annonces` | ✗ | Recherche (category_id, city, price_min, price_max, q) |
| GET | `/api/annonces/:id` | ✗ | Détail annonce |
| POST | `/api/annonces` | ✓ | Créer annonce |
| PUT | `/api/annonces/:id` | ✓ | Modifier annonce |
| DELETE | `/api/annonces/:id` | ✓ | Supprimer annonce |
| GET | `/api/favorites` | ✓ | Mes favoris |
| POST | `/api/favorites/:annonce_id` | ✓ | Ajouter favori |
| DELETE | `/api/favorites/:annonce_id` | ✓ | Retirer favori |
| GET | `/api/conversations` | ✓ | Mes conversations |
| POST | `/api/conversations` | ✓ | Démarrer conversation |
| GET | `/api/conversations/:id/messages` | ✓ | Messages d'une conversation |
| POST | `/api/conversations/:id/messages` | ✓ | Envoyer message |
| GET | `/api/health` | ✗ | Healthcheck |

## Lancement

```bash
docker compose up --build -d
```

L'API sera disponible sur `http://localhost:3000`.
Le schéma de base est appliqué automatiquement au démarrage (`initDb.js`).

## Principes appliqués

- **KISS** : API monolithique simple, un seul service applicatif
- **SOLID** : séparation claire des responsabilités (auth, CRUD, messagerie)
- **Séparation R/W** : lectures sur standby, écritures sur primary via pgpool
- **Sécurité** : bcrypt pour les mots de passe, JWT pour l'authentification
