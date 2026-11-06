-- Tweadup Immo 360 — schéma principal
-- Toutes les tables métier sont dans le schéma "immo" (non exposé à PostgREST).
-- L'application se connecte avec le rôle immo_app (NOBYPASSRLS). Le contexte
-- utilisateur/organisation est transmis par transaction via set_config('app.user_id'|'app.org_id').

create schema if not exists immo;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'immo_app') then
    create role immo_app login nobypassrls;
  end if;
end $$;

grant usage on schema immo to immo_app;

-- ---------------------------------------------------------------------------
-- Contexte
-- ---------------------------------------------------------------------------
create or replace function immo.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function immo.current_org_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- Comptes
-- ---------------------------------------------------------------------------
create table immo.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null,
  password_hash text not null,
  locale text not null default 'fr' check (locale in ('fr','ar')),
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);
create unique index users_email_uniq on immo.users (lower(email));

create table immo.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  branding jsonb not null default '{"primary_color":"#1f4e5f"}',
  contact jsonb not null default '{}',
  settings jsonb not null default '{"communications_enabled":false,"default_locale":"fr","timezone":"Africa/Casablanca","currency":"MAD"}',
  created_at timestamptz not null default now()
);

create table immo.memberships (
  org_id uuid not null references immo.organizations(id) on delete cascade,
  user_id uuid not null references immo.users(id) on delete cascade,
  role text not null check (role in ('admin','project_manager','sales','viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table immo.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references immo.users(id) on delete cascade,
  org_id uuid references immo.organizations(id) on delete set null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

-- Fonctions d'autorisation (SECURITY DEFINER pour éviter la récursion RLS)
create or replace function immo.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = immo, pg_temp as $$
  select exists (
    select 1 from immo.memberships m
    join immo.users u on u.id = m.user_id and u.disabled_at is null
    where m.org_id = p_org and m.user_id = immo.current_user_id()
  )
$$;

create or replace function immo.has_role(p_org uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = immo, pg_temp as $$
  select exists (
    select 1 from immo.memberships m
    join immo.users u on u.id = m.user_id and u.disabled_at is null
    where m.org_id = p_org and m.user_id = immo.current_user_id() and m.role = any(p_roles)
  )
$$;

-- Ligne visible si elle appartient à l'organisation active ET que l'utilisateur en est membre.
create or replace function immo.in_org(p_org uuid) returns boolean
language sql stable as $$
  select p_org = immo.current_org_id() and immo.is_member(p_org)
$$;

create or replace function immo.can_write(p_org uuid, p_roles text[]) returns boolean
language sql stable as $$
  select p_org = immo.current_org_id() and immo.has_role(p_org, p_roles)
$$;

-- ---------------------------------------------------------------------------
-- Projets et structure
-- ---------------------------------------------------------------------------
create table immo.projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  name text not null,
  slug text not null check (slug ~ '^[a-z0-9-]{2,80}$'),
  city text,
  address text,
  description text,
  is_fictional boolean not null default false,
  -- repère commun : origine (0,0) en mètres, axe X = est, axe Y(plan)= nord, angle du nord en degrés
  frame jsonb not null default '{"units":"m","north_deg":0}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug)
);

create table immo.buildings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  project_id uuid not null references immo.projects(id) on delete cascade,
  code text not null,
  name text not null,
  footprint jsonb, -- [[x,y],...] en mètres dans le repère du projet
  sort_order int not null default 0,
  unique (project_id, code)
);

create table immo.floors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  project_id uuid not null references immo.projects(id) on delete cascade,
  building_id uuid not null references immo.buildings(id) on delete cascade,
  level int not null,
  name text not null,
  elevation_m numeric(8,3) not null default 0,
  height_m numeric(6,3) not null default 3,
  unique (building_id, level)
);

create table immo.media (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  project_id uuid references immo.projects(id) on delete cascade,
  lot_id uuid,
  kind text not null check (kind in ('plan_source','plan_page','model','image','capture','video','audio','logo','document')),
  storage_key text not null unique,
  mime text not null,
  size_bytes bigint not null,
  original_name text,
  sha256 text,
  width int,
  height int,
  duration_s numeric(10,3),
  codec text,
  meta jsonb not null default '{}',
  created_by uuid references immo.users(id),
  created_at timestamptz not null default now()
);

create table immo.lots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  project_id uuid not null references immo.projects(id) on delete cascade,
  building_id uuid references immo.buildings(id) on delete set null,
  floor_id uuid references immo.floors(id) on delete set null,
  reference text not null,
  type text not null check (type in ('studio','apartment','duplex','villa','commercial','office','parking','storage')),
  rooms int check (rooms is null or rooms >= 0),
  bedrooms int check (bedrooms is null or bedrooms >= 0),
  -- surfaces : calculée (depuis le plan validé) vs commerciale (saisie)
  surface_calc_m2 numeric(10,2),
  surface_comm_m2 numeric(10,2),
  surface_terrace_m2 numeric(10,2),
  surface_garden_m2 numeric(10,2),
  orientation text check (orientation is null or orientation in ('N','NE','E','SE','S','SO','O','NO')),
  price numeric(14,2) check (price is null or price >= 0),
  currency text not null default 'MAD',
  price_public boolean not null default false,
  status text not null default 'available' check (status in ('available','option','reserved','sold','unavailable')),
  features text[] not null default '{}',
  description text,
  footprint jsonb,
  plan_media_id uuid references immo.media(id) on delete set null,
  image_media_ids uuid[] not null default '{}',
  publishable boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, reference)
);
alter table immo.media add constraint media_lot_fk foreign key (lot_id) references immo.lots(id) on delete set null;
create index lots_project_status on immo.lots (project_id, status);

create table immo.lot_status_history (
  id bigserial primary key,
  org_id uuid not null references immo.organizations(id) on delete cascade,
  lot_id uuid not null references immo.lots(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  author_id uuid references immo.users(id),
  hold_id uuid,
  created_at timestamptz not null default now()
);
create index lot_status_history_lot on immo.lot_status_history (lot_id, created_at desc);

create table immo.amenities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  project_id uuid not null references immo.projects(id) on delete cascade,
  kind text not null check (kind in ('pool','garden','sport','parking','playground','other')),
  name text not null,
  footprint jsonb,
  description text
);

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
create table immo.plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  project_id uuid not null references immo.projects(id) on delete cascade,
  building_id uuid references immo.buildings(id) on delete set null,
  name text not null,
  source_media_id uuid not null references immo.media(id),
  source_type text not null check (source_type in ('pdf','image','dxf')),
  status text not null default 'uploaded' check (status in ('uploaded','processing','ready','error')),
  error text,
  page_count int,
  created_by uuid references immo.users(id),
  created_at timestamptz not null default now()
);

create table immo.plan_pages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  plan_id uuid not null references immo.plans(id) on delete cascade,
  page_index int not null,
  image_media_id uuid references immo.media(id),
  width_px int,
  height_px int,
  selected boolean not null default false,
  rotation int not null default 0 check (rotation in (0,90,180,270)),
  crop jsonb, -- {x,y,w,h} en pixels de l'image source
  scale_m_per_px numeric(14,8), -- null = non calibré
  calibration jsonb, -- {p1:[x,y], p2:[x,y], known_m: number} (points en pixels image)
  floor_id uuid references immo.floors(id) on delete set null,
  level_label text,
  floor_height_m numeric(6,3) not null default 3,
  updated_at timestamptz not null default now(),
  unique (plan_id, page_index)
);

-- Révisions des tracés (murs, pièces, ouvertures) en mètres, repère de la page.
create table immo.plan_drawings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  plan_page_id uuid not null references immo.plan_pages(id) on delete cascade,
  version int not null,
  data jsonb not null,
  note text,
  created_by uuid references immo.users(id),
  created_at timestamptz not null default now(),
  unique (plan_page_id, version)
);

-- ---------------------------------------------------------------------------
-- Maquettes 3D
-- ---------------------------------------------------------------------------
create table immo.models (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  project_id uuid not null references immo.projects(id) on delete cascade,
  name text not null,
  source text not null check (source in ('imported','generated')),
  active_revision_id uuid,
  created_at timestamptz not null default now()
);

create table immo.model_revisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  model_id uuid not null references immo.models(id) on delete cascade,
  version int not null,
  media_id uuid not null references immo.media(id),
  status text not null default 'processing' check (status in ('processing','ready','error')),
  node_names text[] not null default '{}',
  report jsonb not null default '{}',
  error text,
  created_by uuid references immo.users(id),
  created_at timestamptz not null default now(),
  unique (model_id, version)
);
alter table immo.models add constraint models_active_rev_fk foreign key (active_revision_id) references immo.model_revisions(id) on delete set null;

create table immo.model_bindings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  revision_id uuid not null references immo.model_revisions(id) on delete cascade,
  node_name text not null,
  target_type text not null check (target_type in ('building','floor','lot','amenity')),
  target_id uuid not null,
  carried_from uuid, -- binding d'origine si reporté depuis une révision précédente
  created_by uuid references immo.users(id),
  created_at timestamptz not null default now(),
  unique (revision_id, node_name)
);

-- ---------------------------------------------------------------------------
-- Visite : points de vue, séquences (parcours / vidéos)
-- ---------------------------------------------------------------------------
create table immo.viewpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  project_id uuid not null references immo.projects(id) on delete cascade,
  label text not null,
  kind text not null check (kind in ('overview','amenity','building','lot','interior','shot')),
  amenity_id uuid references immo.amenities(id) on delete cascade,
  building_id uuid references immo.buildings(id) on delete cascade,
  lot_id uuid references immo.lots(id) on delete cascade,
  position jsonb not null, -- [x,y,z] repère three.js (y vertical)
  target jsonb not null,
  fov numeric(5,2) not null default 45,
  sort_order int not null default 0,
  show_in_nav boolean not null default true,
  created_at timestamptz not null default now()
);

create table immo.sequences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  project_id uuid not null references immo.projects(id) on delete cascade,
  name text not null,
  kind text not null default 'video' check (kind in ('video','tour')),
  aspect text not null default '16:9' check (aspect in ('16:9','9:16')),
  resolution text not null default '1080p' check (resolution in ('720p','1080p','2160p')),
  fps int not null default 30 check (fps in (24,25,30)),
  shots jsonb not null default '[]', -- [{viewpoint_id, duration_s, transition:'cut'|'fade'|'move'}]
  overlay jsonb not null default '{}', -- {title, subtitle, logo_media_id, music_media_id}
  created_by uuid references immo.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------------
create table immo.prospects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  project_id uuid references immo.projects(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  source text not null default 'other' check (source in ('website','whatsapp','phone','walk_in','referral','portal','social','other')),
  owner_id uuid references immo.users(id) on delete set null,
  stage text not null default 'new' check (stage in ('new','contacted','visit_planned','interested','option','reserved','sold','lost')),
  budget_min numeric(14,2),
  budget_max numeric(14,2),
  notes_private text,
  consent_contact boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index prospects_org_stage on immo.prospects (org_id, stage);

create table immo.prospect_lots (
  org_id uuid not null references immo.organizations(id) on delete cascade,
  prospect_id uuid not null references immo.prospects(id) on delete cascade,
  lot_id uuid not null references immo.lots(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (prospect_id, lot_id)
);

create table immo.interactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  prospect_id uuid not null references immo.prospects(id) on delete cascade,
  kind text not null check (kind in ('note','call','email','whatsapp','visit','inquiry','stage_change','hold')),
  body text,
  meta jsonb not null default '{}',
  author_id uuid references immo.users(id),
  created_at timestamptz not null default now()
);

create table immo.appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  prospect_id uuid references immo.prospects(id) on delete cascade,
  project_id uuid references immo.projects(id) on delete set null,
  user_id uuid references immo.users(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  status text not null default 'planned' check (status in ('requested','planned','done','cancelled','no_show')),
  notes text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table immo.tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  prospect_id uuid references immo.prospects(id) on delete cascade,
  assignee_id uuid references immo.users(id) on delete set null,
  title text not null,
  due_at timestamptz,
  done_at timestamptz,
  created_by uuid references immo.users(id),
  created_at timestamptz not null default now()
);

create table immo.inquiries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  project_id uuid not null references immo.projects(id) on delete cascade,
  prospect_id uuid not null references immo.prospects(id) on delete cascade,
  lot_id uuid references immo.lots(id) on delete set null,
  kind text not null check (kind in ('info','appointment')),
  message text,
  preferred_at timestamptz,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);

-- Options et réservations
create table immo.lot_holds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  lot_id uuid not null references immo.lots(id) on delete cascade,
  prospect_id uuid references immo.prospects(id) on delete set null,
  kind text not null check (kind in ('option','reservation')),
  status text not null default 'active' check (status in ('active','expired','released','converted','sold')),
  expires_at timestamptz,
  reason text,
  idempotency_key text not null,
  created_by uuid references immo.users(id),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (org_id, idempotency_key),
  check (kind <> 'option' or expires_at is not null)
);
-- Garantie d'exclusivité : au plus un engagement actif par lot.
create unique index lot_holds_one_active on immo.lot_holds (lot_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- Traitements, publication, audit
-- ---------------------------------------------------------------------------
create table immo.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  type text not null check (type in ('plan_rasterize','dxf_import','model_inspect','video_export')),
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','done','error')),
  progress numeric(5,2) not null default 0,
  result jsonb,
  error text,
  attempts int not null default 0,
  locked_by text,
  created_by uuid references immo.users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index jobs_queue on immo.jobs (status, created_at);

create table immo.publications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references immo.organizations(id) on delete cascade,
  project_id uuid not null references immo.projects(id) on delete cascade,
  slug text not null,
  version int not null,
  snapshot jsonb not null,
  media_ids uuid[] not null default '{}',
  published_by uuid references immo.users(id),
  published_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (project_id, version)
);
create unique index publications_active_slug on immo.publications (slug) where revoked_at is null;

create table immo.audit_log (
  id bigserial primary key,
  org_id uuid references immo.organizations(id) on delete cascade,
  actor_id uuid references immo.users(id) on delete set null,
  action text not null,
  entity text,
  entity_id uuid,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function immo.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger projects_touch before update on immo.projects for each row execute function immo.touch_updated_at();
create trigger prospects_touch before update on immo.prospects for each row execute function immo.touch_updated_at();
create trigger sequences_touch before update on immo.sequences for each row execute function immo.touch_updated_at();
create trigger plan_pages_touch before update on immo.plan_pages for each row execute function immo.touch_updated_at();

create or replace function immo.lots_before_update() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$;
create trigger lots_touch before update on immo.lots for each row execute function immo.lots_before_update();

-- Historique de statut garanti par la base, quel que soit le chemin de mise à jour.
create or replace function immo.lots_status_history() returns trigger
language plpgsql security definer set search_path = immo, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into immo.lot_status_history (org_id, lot_id, from_status, to_status, reason, author_id)
    values (new.org_id, new.id, null, new.status, coalesce(nullif(current_setting('app.reason', true), ''), 'Création du lot'), immo.current_user_id());
  elsif new.status is distinct from old.status then
    insert into immo.lot_status_history (org_id, lot_id, from_status, to_status, reason, author_id, hold_id)
    values (new.org_id, new.id, old.status, new.status, nullif(current_setting('app.reason', true), ''), immo.current_user_id(),
            nullif(current_setting('app.hold_id', true), '')::uuid);
  end if;
  return new;
end $$;
create trigger lots_history after insert or update of status on immo.lots for each row execute function immo.lots_status_history();

-- Empêche de retirer le dernier administrateur d'une organisation.
create or replace function immo.memberships_keep_admin() returns trigger
language plpgsql security definer set search_path = immo, pg_temp as $$
declare v_org uuid := coalesce(old.org_id, new.org_id);
begin
  if (tg_op = 'DELETE' and old.role = 'admin') or (tg_op = 'UPDATE' and old.role = 'admin' and new.role <> 'admin') then
    if not exists (select 1 from immo.memberships where org_id = v_org and role = 'admin' and user_id <> old.user_id) then
      raise exception 'last_admin' using errcode = 'P0001', hint = 'Une organisation doit conserver au moins un administrateur.';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger memberships_keep_admin before update or delete on immo.memberships for each row execute function immo.memberships_keep_admin();

-- Un statut "option"/"réservé" ne peut être posé directement : il passe par hold_lot().
create or replace function immo.lots_guard_status() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status
     and new.status in ('option','reserved')
     and coalesce(current_setting('app.via_hold', true), '') <> 'on' then
    raise exception 'status_requires_hold' using errcode = 'P0001',
      hint = 'Les options et réservations se posent via une demande d''engagement (transaction contrôlée).';
  end if;
  return new;
end $$;
create trigger lots_guard_status before update of status on immo.lots for each row execute function immo.lots_guard_status();
