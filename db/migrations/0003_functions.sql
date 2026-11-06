-- Fonctions contrôlées (SECURITY DEFINER) : authentification, statuts, engagements,
-- traitements et accès public. Chaque fonction vérifie elle-même les droits.

-- Tout changement de statut passe par change_lot_status() ou hold_lot().
create or replace function immo.lots_guard_status() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.via_status_fn', true), '') <> 'on' then
    raise exception 'status_requires_function' using errcode = 'P0001',
      hint = 'Le statut commercial se modifie via change_lot_status() ou hold_lot().';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Authentification
-- ---------------------------------------------------------------------------
create or replace function immo.auth_user_for_login(p_email text)
returns table (id uuid, password_hash text, disabled boolean)
language sql stable security definer set search_path = immo, pg_temp as $$
  select u.id, u.password_hash, u.disabled_at is not null from immo.users u where lower(u.email) = lower(p_email)
$$;

create or replace function immo.auth_create_session(p_user uuid, p_token_hash text, p_ttl_hours int)
returns uuid language plpgsql security definer set search_path = immo, pg_temp as $$
declare v_org uuid; v_id uuid;
begin
  select m.org_id into v_org from immo.memberships m where m.user_id = p_user
  order by (m.role = 'admin') desc, m.created_at limit 1;
  insert into immo.sessions (user_id, org_id, token_hash, expires_at)
  values (p_user, v_org, p_token_hash, now() + make_interval(hours => p_ttl_hours))
  returning sessions.id into v_id;
  return v_id;
end $$;

create or replace function immo.auth_resolve_session(p_token_hash text)
returns table (user_id uuid, email text, full_name text, locale text, org_id uuid, org_name text, org_slug text, role text)
language sql stable security definer set search_path = immo, pg_temp as $$
  select u.id, u.email, u.full_name, u.locale, o.id, o.name, o.slug, m.role
  from immo.sessions s
  join immo.users u on u.id = s.user_id and u.disabled_at is null
  left join immo.memberships m on m.user_id = u.id and m.org_id = s.org_id
  left join immo.organizations o on o.id = m.org_id
  where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
$$;

create or replace function immo.auth_user_orgs(p_token_hash text)
returns table (org_id uuid, name text, role text)
language sql stable security definer set search_path = immo, pg_temp as $$
  select o.id, o.name, m.role from immo.sessions s
  join immo.memberships m on m.user_id = s.user_id
  join immo.organizations o on o.id = m.org_id
  where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
  order by o.name
$$;

create or replace function immo.auth_switch_org(p_token_hash text, p_org uuid)
returns boolean language plpgsql security definer set search_path = immo, pg_temp as $$
begin
  update immo.sessions s set org_id = p_org
  where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
    and exists (select 1 from immo.memberships m where m.user_id = s.user_id and m.org_id = p_org);
  return found;
end $$;

create or replace function immo.auth_revoke_session(p_token_hash text)
returns void language sql security definer set search_path = immo, pg_temp as $$
  update immo.sessions set revoked_at = now() where token_hash = p_token_hash and revoked_at is null
$$;

-- Création d'un membre par un administrateur de l'organisation active.
create or replace function immo.admin_add_member(p_email text, p_full_name text, p_password_hash text, p_role text)
returns uuid language plpgsql security definer set search_path = immo, pg_temp as $$
declare v_org uuid := immo.current_org_id(); v_user uuid;
begin
  if not immo.has_role(v_org, array['admin']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_role not in ('admin','project_manager','sales','viewer') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  select id into v_user from immo.users where lower(email) = lower(p_email);
  if v_user is null then
    insert into immo.users (email, full_name, password_hash) values (lower(p_email), p_full_name, p_password_hash)
    returning id into v_user;
  end if;
  insert into immo.memberships (org_id, user_id, role) values (v_org, v_user, p_role)
  on conflict (org_id, user_id) do update set role = excluded.role;
  insert into immo.audit_log (org_id, actor_id, action, entity, entity_id, meta)
  values (v_org, immo.current_user_id(), 'member.add', 'user', v_user, jsonb_build_object('role', p_role));
  return v_user;
end $$;

-- ---------------------------------------------------------------------------
-- Statuts commerciaux
-- ---------------------------------------------------------------------------
create or replace function immo.expire_holds() returns int
language plpgsql security definer set search_path = immo, pg_temp as $$
declare r record; n int := 0;
begin
  for r in
    update immo.lot_holds set status = 'expired', ended_at = now()
    where status = 'active' and expires_at is not null and expires_at <= now()
    returning id, lot_id, kind
  loop
    perform set_config('app.via_status_fn', 'on', true);
    perform set_config('app.reason', case when r.kind = 'option' then 'Expiration automatique de l''option' else 'Expiration automatique de la réservation' end, true);
    perform set_config('app.hold_id', r.id::text, true);
    update immo.lots set status = 'available' where id = r.lot_id and status in ('option','reserved');
    n := n + 1;
  end loop;
  perform set_config('app.via_status_fn', '', true);
  perform set_config('app.hold_id', '', true);
  return n;
end $$;

-- Pose d'une option ou d'une réservation. Transactionnel, exclusif et idempotent.
create or replace function immo.hold_lot(
  p_lot uuid, p_kind text, p_prospect uuid, p_minutes int, p_idempotency_key text, p_reason text
) returns immo.lot_holds
language plpgsql security definer set search_path = immo, pg_temp as $$
declare
  v_org uuid := immo.current_org_id();
  v_lot immo.lots;
  v_hold immo.lot_holds;
  v_active immo.lot_holds;
begin
  if not immo.has_role(v_org, array['admin','project_manager','sales']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind not in ('option','reservation') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if coalesce(length(p_idempotency_key), 0) < 8 then raise exception 'idempotency_key_required' using errcode = '22023'; end if;
  if p_kind = 'option' and (p_minutes is null or p_minutes < 5 or p_minutes > 60*24*30) then
    raise exception 'invalid_duration' using errcode = '22023', hint = 'Durée d''option entre 5 minutes et 30 jours.';
  end if;

  -- Verrou exclusif sur le lot : sérialise les demandes concurrentes.
  select * into v_lot from immo.lots where id = p_lot and org_id = v_org for update;
  if not found then raise exception 'lot_not_found' using errcode = 'P0002'; end if;

  -- Idempotence (vérifiée après le verrou pour couvrir les requêtes simultanées).
  select * into v_hold from immo.lot_holds where org_id = v_org and idempotency_key = p_idempotency_key;
  if found then
    if v_hold.lot_id <> p_lot or v_hold.kind <> p_kind then
      raise exception 'idempotency_key_conflict' using errcode = 'P0001';
    end if;
    return v_hold;
  end if;

  if p_prospect is not null and not exists (select 1 from immo.prospects where id = p_prospect and org_id = v_org) then
    raise exception 'prospect_not_found' using errcode = 'P0002';
  end if;

  perform immo.expire_holds();
  select * into v_lot from immo.lots where id = p_lot;
  select * into v_active from immo.lot_holds where lot_id = p_lot and status = 'active';

  if p_kind = 'option' then
    if v_lot.status <> 'available' then
      raise exception 'lot_not_available' using errcode = 'P0001', detail = v_lot.status;
    end if;
  else
    if v_lot.status = 'available' then
      null;
    elsif v_lot.status = 'option' and v_active.id is not null and v_active.prospect_id is not distinct from p_prospect then
      update immo.lot_holds set status = 'converted', ended_at = now() where id = v_active.id;
    else
      raise exception 'lot_not_available' using errcode = 'P0001', detail = v_lot.status;
    end if;
  end if;

  insert into immo.lot_holds (org_id, lot_id, prospect_id, kind, expires_at, reason, idempotency_key, created_by)
  values (v_org, p_lot, p_prospect, p_kind,
          case when p_minutes is null then null else now() + make_interval(mins => p_minutes) end,
          p_reason, p_idempotency_key, immo.current_user_id())
  returning * into v_hold;

  perform set_config('app.via_status_fn', 'on', true);
  perform set_config('app.hold_id', v_hold.id::text, true);
  perform set_config('app.reason', coalesce(nullif(p_reason, ''), case when p_kind = 'option' then 'Option posée' else 'Réservation' end), true);
  update immo.lots set status = case when p_kind = 'option' then 'option' else 'reserved' end where id = p_lot;
  perform set_config('app.via_status_fn', '', true);
  perform set_config('app.hold_id', '', true);

  if p_prospect is not null then
    insert into immo.prospect_lots (org_id, prospect_id, lot_id) values (v_org, p_prospect, p_lot) on conflict do nothing;
    insert into immo.interactions (org_id, prospect_id, kind, body, author_id, meta)
    values (v_org, p_prospect, 'hold', (case when p_kind = 'option' then 'Option posée sur ' else 'Réservation de ' end) || v_lot.reference,
            immo.current_user_id(), jsonb_build_object('lot_id', p_lot, 'hold_id', v_hold.id));
    update immo.prospects set stage = case when p_kind = 'option' then 'option' else 'reserved' end
    where id = p_prospect and stage not in ('sold');
  end if;
  return v_hold;
end $$;

-- Changement de statut manuel (libération, vente, indisponibilité...) avec motif obligatoire.
create or replace function immo.change_lot_status(p_lot uuid, p_status text, p_reason text)
returns immo.lots language plpgsql security definer set search_path = immo, pg_temp as $$
declare
  v_org uuid := immo.current_org_id();
  v_lot immo.lots;
  v_hold immo.lot_holds;
  v_is_manager boolean := immo.has_role(v_org, array['admin','project_manager']);
begin
  if not immo.has_role(v_org, array['admin','project_manager','sales']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required' using errcode = '22023'; end if;
  if p_status in ('option','reserved') then
    raise exception 'use_hold_lot' using errcode = '22023', hint = 'Utiliser hold_lot() pour une option ou une réservation.';
  end if;
  select * into v_lot from immo.lots where id = p_lot and org_id = v_org for update;
  if not found then raise exception 'lot_not_found' using errcode = 'P0002'; end if;
  if v_lot.status = p_status then return v_lot; end if;

  -- Règles de transition
  if p_status = 'sold' and v_lot.status <> 'reserved' then
    raise exception 'invalid_transition' using errcode = 'P0001', detail = v_lot.status || ' -> sold';
  end if;
  if v_lot.status in ('reserved','sold','unavailable') and not v_is_manager then
    raise exception 'forbidden_transition' using errcode = '42501', detail = 'Réservé pour les administrateurs et chefs de projet';
  end if;
  if p_status = 'unavailable' and not v_is_manager then
    raise exception 'forbidden_transition' using errcode = '42501';
  end if;

  select * into v_hold from immo.lot_holds where lot_id = p_lot and status = 'active';
  if found then
    update immo.lot_holds set status = case when p_status = 'sold' then 'sold' else 'released' end, ended_at = now()
    where id = v_hold.id;
    if p_status = 'sold' and v_hold.prospect_id is not null then
      update immo.prospects set stage = 'sold' where id = v_hold.prospect_id;
    end if;
  end if;

  perform set_config('app.via_status_fn', 'on', true);
  perform set_config('app.reason', p_reason, true);
  perform set_config('app.hold_id', coalesce(v_hold.id::text, ''), true);
  update immo.lots set status = p_status where id = p_lot returning * into v_lot;
  perform set_config('app.via_status_fn', '', true);
  perform set_config('app.hold_id', '', true);
  return v_lot;
end $$;

-- ---------------------------------------------------------------------------
-- Traitements (worker)
-- ---------------------------------------------------------------------------
create or replace function immo.claim_job(p_worker text, p_types text[])
returns immo.jobs language plpgsql security definer set search_path = immo, pg_temp as $$
declare v immo.jobs;
begin
  -- Remet en file les traitements bloqués (worker arrêté) après 30 minutes.
  update immo.jobs set status = 'queued', locked_by = null
  where status = 'running' and started_at < now() - interval '30 minutes' and attempts < 3;

  select * into v from immo.jobs
  where status = 'queued' and type = any(p_types)
  order by created_at
  for update skip locked limit 1;
  if not found then return null; end if;
  update immo.jobs set status = 'running', locked_by = p_worker, started_at = now(), attempts = attempts + 1, progress = 0
  where id = v.id returning * into v;
  return v;
end $$;

create or replace function immo.job_progress(p_job uuid, p_progress numeric)
returns void language sql security definer set search_path = immo, pg_temp as $$
  update immo.jobs set progress = least(100, greatest(0, p_progress)) where id = p_job and status = 'running'
$$;

create or replace function immo.finish_job(p_job uuid, p_status text, p_result jsonb, p_error text)
returns void language plpgsql security definer set search_path = immo, pg_temp as $$
begin
  if p_status not in ('done','error') then raise exception 'invalid_status'; end if;
  update immo.jobs set status = p_status, result = p_result, error = left(p_error, 2000),
    progress = case when p_status = 'done' then 100 else progress end, finished_at = now()
  where id = p_job;
end $$;

-- ---------------------------------------------------------------------------
-- Accès public : uniquement la version publiée (instantané) + statuts en direct.
-- ---------------------------------------------------------------------------
create or replace function immo.public_get_publication(p_slug text)
returns jsonb language sql stable security definer set search_path = immo, pg_temp as $$
  select jsonb_build_object(
    'publication_id', p.id,
    'version', p.version,
    'published_at', p.published_at,
    'snapshot', p.snapshot,
    'statuses', coalesce((
      select jsonb_object_agg(l.id, l.status) from immo.lots l
      where l.project_id = p.project_id and l.publishable
        and l.id in (select (x->>'id')::uuid from jsonb_array_elements(p.snapshot->'lots') x)
    ), '{}'::jsonb)
  )
  from immo.publications p
  where p.slug = p_slug and p.revoked_at is null
  order by p.version desc limit 1
$$;

create or replace function immo.public_media_allowed(p_slug text, p_media uuid)
returns table (storage_key text, mime text)
language sql stable security definer set search_path = immo, pg_temp as $$
  select m.storage_key, m.mime from immo.publications p
  join immo.media m on m.id = p_media and m.org_id = p.org_id
  where p.slug = p_slug and p.revoked_at is null and p_media = any(p.media_ids)
  limit 1
$$;

-- Demande publique : crée un intérêt commercial (prospect + demande), jamais une réservation.
create or replace function immo.public_submit_inquiry(
  p_slug text, p_kind text, p_full_name text, p_email text, p_phone text,
  p_message text, p_lot uuid, p_preferred_at timestamptz, p_consent boolean, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = immo, pg_temp as $$
declare
  v_pub immo.publications;
  v_prospect uuid;
  v_inquiry immo.inquiries;
  v_owner uuid;
  v_lot_ref text;
begin
  select * into v_pub from immo.publications where slug = p_slug and revoked_at is null order by version desc limit 1;
  if not found then raise exception 'publication_not_found' using errcode = 'P0002'; end if;
  if p_kind not in ('info','appointment') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  if coalesce(trim(p_full_name), '') = '' or length(p_full_name) > 200 then raise exception 'invalid_name' using errcode = '22023'; end if;
  if coalesce(trim(p_email), '') = '' and coalesce(trim(p_phone), '') = '' then
    raise exception 'contact_required' using errcode = '22023';
  end if;
  if not coalesce(p_consent, false) then raise exception 'consent_required' using errcode = '22023'; end if;
  if coalesce(length(p_idempotency_key), 0) < 8 then raise exception 'idempotency_key_required' using errcode = '22023'; end if;

  select * into v_inquiry from immo.inquiries where org_id = v_pub.org_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('inquiry_id', v_inquiry.id, 'duplicate', true);
  end if;

  if p_lot is not null then
    if not exists (select 1 from jsonb_array_elements(v_pub.snapshot->'lots') x where (x->>'id')::uuid = p_lot) then
      raise exception 'lot_not_published' using errcode = 'P0002';
    end if;
    select reference into v_lot_ref from immo.lots where id = p_lot;
  end if;

  -- Rapprochement avec un prospect existant (même organisation, même email ou téléphone).
  select id, owner_id into v_prospect, v_owner from immo.prospects
  where org_id = v_pub.org_id
    and ((nullif(trim(p_email), '') is not null and lower(email) = lower(trim(p_email)))
      or (nullif(trim(p_phone), '') is not null and regexp_replace(phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g')))
  order by created_at limit 1;

  if v_prospect is null then
    insert into immo.prospects (org_id, project_id, full_name, email, phone, source, stage, consent_contact)
    values (v_pub.org_id, v_pub.project_id, trim(p_full_name), nullif(lower(trim(p_email)), ''), nullif(trim(p_phone), ''), 'website', 'new', true)
    returning id into v_prospect;
  end if;

  insert into immo.inquiries (org_id, project_id, prospect_id, lot_id, kind, message, preferred_at, idempotency_key)
  values (v_pub.org_id, v_pub.project_id, v_prospect, p_lot, p_kind, left(p_message, 4000), p_preferred_at, p_idempotency_key)
  returning * into v_inquiry;

  if p_lot is not null then
    insert into immo.prospect_lots (org_id, prospect_id, lot_id) values (v_pub.org_id, v_prospect, p_lot) on conflict do nothing;
  end if;

  insert into immo.interactions (org_id, prospect_id, kind, body, meta)
  values (v_pub.org_id, v_prospect, 'inquiry',
          case when p_kind = 'appointment' then 'Demande de rendez-vous' else 'Demande d''information' end
            || coalesce(' — lot ' || v_lot_ref, '') || coalesce(E'\n' || left(p_message, 4000), ''),
          jsonb_build_object('inquiry_id', v_inquiry.id, 'lot_id', p_lot, 'preferred_at', p_preferred_at));

  if p_kind = 'appointment' and p_preferred_at is not null then
    insert into immo.appointments (org_id, prospect_id, project_id, user_id, title, starts_at, ends_at, status, notes)
    values (v_pub.org_id, v_prospect, v_pub.project_id, v_owner, 'Demande de visite (à confirmer)', p_preferred_at,
            p_preferred_at + interval '1 hour', 'requested', 'Créneau souhaité par le visiteur, non confirmé.');
  end if;

  insert into immo.tasks (org_id, prospect_id, assignee_id, title, due_at)
  values (v_pub.org_id, v_prospect, v_owner, 'Traiter la demande web de ' || trim(p_full_name), now() + interval '1 day');

  return jsonb_build_object('inquiry_id', v_inquiry.id, 'duplicate', false);
end $$;

-- Droits d'exécution : uniquement les fonctions prévues pour l'application.
revoke all on all functions in schema immo from public;
grant execute on function
  immo.current_user_id(), immo.current_org_id(), immo.is_member(uuid), immo.has_role(uuid, text[]),
  immo.in_org(uuid), immo.can_write(uuid, text[]),
  immo.auth_user_for_login(text), immo.auth_create_session(uuid, text, int), immo.auth_resolve_session(text),
  immo.auth_user_orgs(text), immo.auth_switch_org(text, uuid), immo.auth_revoke_session(text),
  immo.admin_add_member(text, text, text, text),
  immo.expire_holds(), immo.hold_lot(uuid, text, uuid, int, text, text), immo.change_lot_status(uuid, text, text),
  immo.claim_job(text, text[]), immo.job_progress(uuid, numeric), immo.finish_job(uuid, text, jsonb, text),
  immo.public_get_publication(text), immo.public_media_allowed(text, uuid),
  immo.public_submit_inquiry(text, text, text, text, text, text, uuid, timestamptz, boolean, text)
to immo_app;
-- Les fonctions trigger s'exécutent sans grant EXECUTE explicite.
