# Mise en ligne sur Vercel

L'application web (Next.js) se déploie sur Vercel. Trois services externes sont nécessaires, car une fonction Vercel
n'a ni disque persistant, ni Chromium/ffmpeg, et ses requêtes sont limitées à 4,5 Mo :

| Besoin | Service conseillé | Rôle |
|---|---|---|
| Base de données | **Supabase** (PostgreSQL) | données, RLS |
| Fichiers | **Supabase Storage** (API S3) ou Cloudflare R2 | plans, maquettes, images, vidéos |
| Traitements | **Worker** sur Railway, Render, Fly.io ou un petit serveur (image Docker fournie) | PDF → images, DXF, inspection GLB, export vidéo |

Sans worker, l'application fonctionne mais les plans importés, maquettes et vidéos restent « en file ».

## Installation automatique (intégration Supabase de Vercel)
Projet Vercel → Storage → Create Database → Supabase (connecté au projet) : l'intégration fournit `POSTGRES_URL`,
`POSTGRES_URL_NON_POOLING`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`… Ajouter ensuite `IMMO_APP_DB_PASSWORD`,
`SEED_PASSWORD`, `SETUP_KEY` (64 caractères), `STORAGE_DRIVER=supabase`, redéployer, puis appeler une fois
`POST /api/setup` avec `Authorization: Bearer <SETUP_KEY>` (migrations, rôle `immo_app`, bucket, démo fictive).
La connexion `immo_app` est dérivée de `POSTGRES_URL` (pas de `DATABASE_URL` à saisir). Désactiver ensuite `SETUP_KEY`.

## 1. Base de données (Supabase)

Sans outil installé : exécuter le fichier SQL d'installation complet (schéma + données) dans l'éditeur SQL de Supabase
(kit `deploy-vercel/`, généré par `pg_dump --no-owner --inserts -n immo --exclude-table-data=immo.sessions`). Sinon :

1. Créer un projet Supabase (région Europe, ex. Frankfurt).
2. Depuis votre poste, avec la chaîne de connexion **directe** (Settings → Database, port 5432, utilisateur `postgres`) :
   ```bash
   export DATABASE_ADMIN_URL='postgres://postgres:MOT_DE_PASSE@db.<ref>.supabase.co:5432/postgres'
   export DATABASE_SSL=no-verify IMMO_APP_DB_PASSWORD='un-mot-de-passe-long'
   pnpm db:migrate
   ```
   Pour reprendre vos données actuelles (dont la Villa V.68) :
   `pg_restore --no-owner --no-acl -d "$DATABASE_ADMIN_URL" base-immo360.dump` puis à nouveau `pnpm db:migrate`.
   Pour une base de démonstration vide : `pnpm db:seed`.
3. Chaîne de connexion de l'application (pooler Supavisor, mode transaction, port 6543) :
   `postgres://immo_app.<ref>:IMMO_APP_DB_PASSWORD@aws-0-<region>.pooler.supabase.com:6543/postgres`

Le schéma `immo` n'est pas exposé par l'API REST de Supabase : ne l'ajoutez pas aux « Exposed schemas ».

## 2. Stockage des fichiers (Supabase Storage, API S3)
1. Storage → New bucket `immo360`, **privé**.
2. Storage → Settings → S3 Connection : activer, noter l'endpoint (`https://<ref>.supabase.co/storage/v1/s3`) et la région,
   créer une clé d'accès (Access key ID + Secret).
3. CORS : les navigateurs envoient les fichiers directement au stockage et lisent les maquettes par lien signé.
   Autoriser l'origine de votre site Vercel (méthodes GET, PUT, HEAD ; en-têtes `*`). Sur Supabase Storage, l'API S3
   accepte les requêtes cross-origin ; sur R2/S3, définir une règle CORS du bucket.
4. Copier vos fichiers existants (depuis le poste où se trouve `storage/`) :
   ```bash
   STORAGE_DIR=./storage S3_ENDPOINT=… S3_REGION=… S3_BUCKET=immo360 S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… pnpm --filter @immo/db storage:to-s3
   ```

## 3. Projet Vercel
1. Vercel → Add New → Project → importer le dépôt GitHub `tweadupcenter/app1`, branche `immo-360`.
2. **Root Directory : `apps/web`** (laisser « Include files outside the root directory » activé).
   Framework : Next.js. Les commandes sont dans `apps/web/vercel.json`.
3. Variables d'environnement (Production) :

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | chaîne du pooler Supabase (étape 1.3) |
| `DATABASE_SSL` | `no-verify` |
| `DB_POOL_MAX` | `2` |
| `APP_SECRET` | 32+ caractères aléatoires (identique dans le worker) |
| `APP_URL` | `https://votre-projet.vercel.app` (ou votre domaine) |
| `ALLOWED_ORIGINS` | votre domaine si différent de l'hôte Vercel (sinon vide) |
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | étape 2 |
| `S3_FORCE_PATH_STYLE` | `true` |
| `CRON_SECRET` | chaîne aléatoire (sécurise la tâche planifiée d'expiration des options) |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` (utilise pnpm 10.28 déclaré dans `package.json`) |

4. Déployer. Vérifier `https://…/api/health` → `{"ok":true,"db":"ok"}`.
5. Tâche planifiée : `vercel.json` déclare `/api/cron/expire-holds` une fois par jour (limite du plan Hobby ; sur le plan
   Pro, passer à `*/10 * * * *`). Les options expirent de toute façon à chaque lecture des lots et dans le worker.

## 4. Worker
Image : `docker build --target worker -t immo360-worker .` (Chromium, ffmpeg, poppler inclus). Variables :
`DATABASE_URL` (même rôle `immo_app`, connexion directe ou pooler en mode session), `DATABASE_SSL=no-verify`,
`APP_SECRET` (identique), `APP_URL` (URL Vercel : la page de rendu vidéo y est chargée), `STORAGE_DRIVER=s3` et les `S3_*`.
Une seule instance suffit ; plusieurs peuvent tourner en parallèle.

## Limites propres à Vercel
- Import CSV : fichier de 2 Mo maximum (taille des requêtes de formulaire).
- Limiteur de tentatives de connexion en mémoire : il n'est pas partagé entre les instances serverless.
- Durée maximale d'une fonction : 60 s (fiches PDF, publication) — suffisant pour les volumes de démonstration.
