# Déploiement

## Composants
1. PostgreSQL 16 (managé, ou Supabase).
2. Application web Next.js (`pnpm build && pnpm start`) derrière un reverse proxy HTTPS.
3. Worker (`pnpm worker`) sur une machine/conteneur disposant de poppler-utils, ffmpeg (libx264) et Chromium ;
   il doit joindre la base et l'URL `APP_URL` (page de rendu vidéo).
4. Stockage de fichiers persistant partagé entre web et worker (`STORAGE_DIR`, volume) — ou adaptateur S3 à ajouter.

## Déploiement avec Docker (serveur unique)
```bash
cp .env.example .env    # POSTGRES_PASSWORD, IMMO_APP_DB_PASSWORD, APP_SECRET, APP_URL=https://votre-domaine, ALLOWED_ORIGINS=votre-domaine
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```
- `Dockerfile` multi-cibles : `web` (Next.js) et `worker` (image Playwright + ffmpeg + poppler).
- Le service `migrate` applique les migrations avant le démarrage du web.
- Placez un reverse proxy HTTPS (Caddy, Traefik, Nginx) devant `127.0.0.1:3000`.
- Sonde de santé : `GET /api/health` (base comprise), utilisée par le `HEALTHCHECK` de l'image.
- Derrière un proxy dont le domaine public diffère de l'hôte interne, renseignez `ALLOWED_ORIGINS`
  (domaines séparés par des virgules), sinon les formulaires (Server Actions) et les envois de fichiers sont refusés.
- Sauvegardes : `scripts/backup.sh` (base + fichiers, rétention 14 jours), à planifier chaque jour par cron.
- Données existantes : restaurer un dump avec `pg_restore --no-owner -d immo360 fichier.dump` puis relancer `migrate`.

> Le Dockerfile n'a pas pu être construit dans l'environnement de développement (le téléchargement de pnpm
> depuis le conteneur de build y est bloqué par le proxy réseau). Faites un premier build de contrôle sur votre serveur.

## Variables
Voir `.env.example`. Ne jamais exposer `DATABASE_ADMIN_URL` à l'application ; aucune clé privilégiée n'est envoyée au
navigateur (aucune variable `NEXT_PUBLIC_*` sensible). `APP_SECRET` : 32+ caractères aléatoires.

## Base
```bash
DATABASE_ADMIN_URL=... IMMO_APP_DB_PASSWORD=... pnpm db:migrate
```
Le rôle `immo_app` est créé par la migration (rôle de cluster : utiliser le même mot de passe pour toutes les bases du cluster).

### Supabase
- Utiliser la chaîne de connexion « direct » (port 5432) avec l'utilisateur `postgres` pour `DATABASE_ADMIN_URL`.
- Pour l'application : `postgres://immo_app.<project-ref>:<mot de passe>@<pooler>:5432/postgres` (mode session) ou
  connexion directe. Le mode transaction (6543) convient aussi : le contexte RLS est posé par transaction.
- Le schéma `immo` n'est pas exposé à l'API REST (ne pas l'ajouter aux « exposed schemas »).
- Supabase Auth et Storage ne sont pas utilisés dans cette version.

## Isolation des conversions
En production, exécuter le worker dans un conteneur dédié, sans accès réseau sortant hormis la base et APP_URL,
avec limites CPU/mémoire (les commandes externes ont déjà des délais maximaux et sont lancées sans shell).

## Journaux
Les journaux du worker n'affichent ni chaînes de connexion ni jetons. Les erreurs de base sont traduites pour
l'utilisateur ; le détail technique reste côté serveur.

## Mise à l'échelle
Le limiteur de tentatives de connexion et de demandes publiques est en mémoire (une instance) : utiliser un stockage
partagé (Redis) ou le reverse proxy pour plusieurs instances. Plusieurs workers peuvent tourner en parallèle.
