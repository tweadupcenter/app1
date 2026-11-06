# Tweadup Immo 360

Plateforme de présentation immobilière 3D et de gestion commerciale pour promoteurs et agences :
import et calibration de plans, éditeur 2D, reconstruction 3D simple et import GLB, visite interactive
(three.js), gestion des lots avec options/réservations transactionnelles, CRM, export vidéo MP4 réel,
fiches PDF, présentation publique. Interface en français (arabe RTL disponible), MAD, m², Africa/Casablanca.

> Les données de démonstration (« Résidence Al Nakhil », organisations, prospects) sont **fictives**.

## Structure

| Dossier | Rôle |
|---|---|
| `apps/web` | Application Next.js 15 (App Router, TypeScript, React 19, React Three Fiber) |
| `apps/worker` | Worker séparé : PDF→PNG (pdftoppm), DXF, inspection GLB, export vidéo (Chromium + ffmpeg), expiration des options |
| `packages/core` | Domaine partagé : géométrie, tracés, reconstruction 3D, écriture/lecture GLB, CSV, séquences caméra, contrat Unreal |
| `db` | Migrations SQL (RLS), seed de démonstration, tests d'intégration PostgreSQL |
| `samples` | Plans fictifs d'exemple (PDF 2 pages, PNG, DXF en mm) et CSV |
| `docs` | Architecture, guide administrateur, déploiement, Unreal, limitations |

## Prérequis

- Node.js ≥ 22, pnpm 10 (`corepack enable`)
- PostgreSQL 16 (natif ou `docker compose up -d db`) — compatible avec la base Postgres de Supabase
- Worker : `pdftoppm`/`pdfinfo` (poppler-utils), `ffmpeg`/`ffprobe` avec libx264, Chromium pour Playwright (`npx playwright install chromium`)

## Installation et lancement

```bash
pnpm install
cp .env.example .env            # puis renseigner les mots de passe et APP_SECRET (32+ caractères)
createdb immo360                # ou docker compose up -d db
pnpm db:migrate                 # schéma, RLS, fonctions ; crée le rôle immo_app
pnpm db:seed                    # résidence fictive (3 bâtiments, 43 lots, équipements, CRM)
pnpm build && pnpm start        # application sur http://localhost:3000
pnpm worker                     # dans un second terminal (requis pour plans, maquettes, vidéos)
```

Développement : `pnpm dev`. Réinitialisation complète des données de démo : `pnpm db:reset`.

Comptes de démonstration (mot de passe = `SEED_PASSWORD`, `demo-immo-360` par défaut — à changer) :
`admin@demo.example`, `chef.projet@demo.example`, `commercial@demo.example`, `commercial2@demo.example`,
`lecteur@demo.example` ; organisation distincte pour le contrôle d'isolation : `admin@temoin.example`.
Présentation publique : `/p/al-nakhil-demo`.

## Tests

```bash
pnpm test                       # unitaires (core) + intégration PostgreSQL (db) — base immo360_test
cd apps/web && E2E_RESET=1 pnpm test:e2e   # parcours complets (serveur + worker démarrés ; E2E_RESET réinitialise la base !)
```

`DATABASE_ADMIN_URL_TEST` permet de choisir la base des tests d'intégration (défaut `postgres://postgres:postgres@localhost:5432/immo360_test`).

Voir aussi : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md) ·
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) · [docs/UNREAL.md](docs/UNREAL.md) · [docs/LIMITATIONS.md](docs/LIMITATIONS.md)
