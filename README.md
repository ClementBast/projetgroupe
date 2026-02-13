# VendreFacile

Plateforme web de petites annonces gratuites (type LeBonCoin).
Projet réalisé dans le cadre du TP d'architecture n-tiers.

## Stack

Le backend est une API Node.js (Express) qui tourne derrière un frontend servi par Nginx.
Côté données, on utilise un cluster PostgreSQL 17 en haute disponibilité : un nœud primary (`pg-0`) et deux standbys (`pg-1`, `pg-2`), orchestrés par `repmgr`. Pgpool-II est placé devant pour le load-balancing des lectures et le failover automatique.

L'API sépare les écritures (via pgpool, redirigées vers le primary) et les lectures (directement sur un standby) pour réduire la charge.

## Fonctionnalités

- Inscription / connexion (JWT + bcrypt)
- CRUD annonces (créer, modifier, supprimer, changer le statut)
- Recherche par catégorie, ville, prix, texte libre
- Favoris
- Messagerie interne entre acheteur et vendeur
- Gestion de profil

## Lancement

```bash
docker compose up --build -d
```

Le frontend est accessible sur `http://localhost:8080`.
Le schéma de base et les données de démo sont créés automatiquement au premier lancement (`initDb.js`).

Comptes de démo :
- `seller@vendrefacile.local` / `password123`
- `buyer@vendrefacile.local` / `password123`

## Structure du projet

```
api/           API Express (src/index.js, src/initDb.js)
frontend/      Interface web (index.html) + config Nginx
docs/          Schémas d'architecture (schemas.html)
docker-compose.yml
```

## Documentation

Les schémas (use case, séquence, classes, C4, architecture, DDD, ERD, base distribuée) sont dans `docs/schemas.html` — il suffit de l'ouvrir dans un navigateur.
