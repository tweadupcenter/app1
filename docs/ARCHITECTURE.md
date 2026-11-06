# Architecture

## Choix

- **Web** : Next.js 15.5 (App Router, Server Components, Server Actions), React 19.3, TypeScript 5.9.
  TypeScript 7 a été écarté (non pris en charge par Next 15). Dépendances verrouillées (`pnpm-lock.yaml`, versions exactes).
- **3D web** : three.js 0.187, @react-three/fiber 9.8, @react-three/drei 10.7. Les maquettes sont des GLB (glTF 2.0).
- **Données** : PostgreSQL 16. Supabase (Postgres) est une cible de déploiement compatible ; l'authentification et le
  stockage sont implémentés dans l'application (voir « Pourquoi pas Supabase Auth/Storage »).
- **Worker** séparé (Node + tsx) pour les traitements longs ou risqués, avec file de travaux en base (`FOR UPDATE SKIP LOCKED`).
- **Mode Unreal** : contrat de messages et adaptateur Pixel Streaming ; non opérationnel sans moteur (voir UNREAL.md).

## Sécurité des données

- Schéma `immo` (non exposé à PostgREST). L'application et le worker se connectent avec le rôle `immo_app`
  (`NOBYPASSRLS`), jamais avec le rôle propriétaire.
- Chaque requête s'exécute dans une transaction portant `app.user_id` et `app.org_id` (`set_config(..., true)`).
  Les politiques RLS exigent que la ligne appartienne à l'organisation active **et** que l'utilisateur en soit membre ;
  les écritures sont limitées par rôle (`admin`, `project_manager`, `sales`, `viewer`).
- Les opérations sensibles passent par des fonctions `SECURITY DEFINER` qui vérifient elles-mêmes les droits :
  authentification (`auth_*`), engagements (`hold_lot`, `change_lot_status`, `expire_holds`), file de travaux,
  accès public (`public_get_publication`, `public_media_allowed`, `public_submit_inquiry`).
- Statut commercial : modification directe interdite par trigger ; historique (auteur, date, motif) écrit par trigger.
- Exclusivité : index unique partiel « un seul engagement actif par lot » + verrou `FOR UPDATE` ; idempotence par clé unique.
- Sessions : jeton aléatoire en cookie `httpOnly`, seul son SHA-256 est stocké ; table non lisible par l'application.
  Mots de passe : scrypt.
- Fichiers privés sur disque hors du dossier public, servis après contrôle RLS ; fichiers publics servis uniquement
  s'ils figurent dans une publication active (révoquer la publication révoque les liens).
- Uploads : type détecté par signature, limites de taille, noms aléatoires ; conversions dans le worker
  (processus externes sans shell, environnement minimal, délais maximaux).
- Protection CSRF : Server Actions (contrôle d'origine natif de Next) et contrôle `Origin` sur les routes API en écriture.

## Version de travail / version publique

La publication fige un instantané JSON (`publications.snapshot`) ne contenant que les champs publiables
(prix uniquement si `price_public`, aucune note, aucune surface calculée interne, aucun prospect). Les statuts de
disponibilité sont lus en direct. La présentation publique ne lit jamais les tables de travail.

## Repère et unités

Plans : mètres, x vers l'est, y vers le nord. Three.js : y vertical, nord = −z (`planToWorld`). Les tracés sont
stockés en mètres ; chaque page de plan conserve rotation, recadrage et échelle (m/px) issue de la calibration.
Chaque élément porte une provenance : documenté, estimé, proposé, validé. Seuls les éléments validés sont
reconstruits en 3D et comptent dans les surfaces calculées.

## Identifiants partagés

Projets, bâtiments, étages, lots, équipements et points de vue sont des UUID de la base, utilisés tels quels par la
visite web, l'export vidéo et le contrat Unreal. Les associations maquette→objets métier (`model_bindings`) sont
liées à une révision de maquette ; à l'import d'une révision, le worker reporte celles dont le nœud existe encore et
signale les nœuds disparus.

## Pourquoi pas Supabase Auth/Storage

L'environnement de développement ne permettait pas de faire tourner la pile Supabase locale. Pour livrer un système
testé de bout en bout, l'authentification et le stockage sont implémentés côté serveur. La base est du PostgreSQL
standard : elle se déploie sur Supabase (connexion directe ou pooler) sans modification. L'interface `StorageAdapter`
(`packages/core/src/storage.ts`) permet d'ajouter un adaptateur Supabase Storage/S3.
