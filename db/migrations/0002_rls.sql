-- Politiques RLS : isolation stricte par organisation + droits par rôle.

-- Sessions : aucun accès direct, uniquement via fonctions auth_*.
alter table immo.sessions enable row level security;
alter table immo.sessions force row level security;

-- Utilisateurs : soi-même et membres de l'organisation active.
alter table immo.users enable row level security;
create policy users_select on immo.users for select using (
  id = immo.current_user_id()
  or exists (select 1 from immo.memberships m where m.user_id = users.id and immo.in_org(m.org_id))
);
create policy users_update_self on immo.users for update using (id = immo.current_user_id()) with check (id = immo.current_user_id());
grant select, update (full_name, locale, password_hash) on immo.users to immo_app;

alter table immo.organizations enable row level security;
create policy org_select on immo.organizations for select using (immo.is_member(id));
create policy org_update on immo.organizations for update using (immo.can_write(id, array['admin'])) with check (immo.can_write(id, array['admin']));
grant select, update (name, branding, contact, settings) on immo.organizations to immo_app;

alter table immo.memberships enable row level security;
create policy memberships_select on immo.memberships for select using (immo.in_org(org_id) or user_id = immo.current_user_id());
create policy memberships_admin_ins on immo.memberships for insert with check (immo.can_write(org_id, array['admin']));
create policy memberships_admin_upd on immo.memberships for update using (immo.can_write(org_id, array['admin'])) with check (immo.can_write(org_id, array['admin']));
create policy memberships_admin_del on immo.memberships for delete using (immo.can_write(org_id, array['admin']));
grant select, insert, update (role), delete on immo.memberships to immo_app;

-- Macro : tables métier standard.
do $$
declare
  t record;
begin
  for t in
    select * from (values
      -- table, rôles en écriture
      ('projects',       array['admin','project_manager']),
      ('buildings',      array['admin','project_manager']),
      ('floors',         array['admin','project_manager']),
      ('amenities',      array['admin','project_manager']),
      ('lots',           array['admin','project_manager']),
      ('plans',          array['admin','project_manager']),
      ('plan_pages',     array['admin','project_manager']),
      ('plan_drawings',  array['admin','project_manager']),
      ('models',         array['admin','project_manager']),
      ('model_revisions',array['admin','project_manager']),
      ('model_bindings', array['admin','project_manager']),
      ('viewpoints',     array['admin','project_manager']),
      ('sequences',      array['admin','project_manager','sales']),
      ('media',          array['admin','project_manager','sales']),
      ('prospects',      array['admin','project_manager','sales']),
      ('prospect_lots',  array['admin','project_manager','sales']),
      ('interactions',   array['admin','project_manager','sales']),
      ('appointments',   array['admin','project_manager','sales']),
      ('tasks',          array['admin','project_manager','sales']),
      ('publications',   array['admin','project_manager'])
    ) as v(tbl, roles)
  loop
    execute format('alter table immo.%I enable row level security', t.tbl);
    execute format('create policy %I on immo.%I for select using (immo.in_org(org_id))', t.tbl || '_sel', t.tbl);
    execute format('create policy %I on immo.%I for insert with check (immo.can_write(org_id, %L))', t.tbl || '_ins', t.tbl, t.roles);
    execute format('create policy %I on immo.%I for update using (immo.can_write(org_id, %L)) with check (immo.can_write(org_id, %L))', t.tbl || '_upd', t.tbl, t.roles, t.roles);
    execute format('create policy %I on immo.%I for delete using (immo.can_write(org_id, %L))', t.tbl || '_del', t.tbl, t.roles);
    execute format('grant select, insert, update, delete on immo.%I to immo_app', t.tbl);
  end loop;
end $$;

-- Lecteurs internes : pas d'accès aux notes privées des prospects -> vue filtrée côté app,
-- et la colonne notes_private n'est jamais renvoyée aux rôles "viewer" (contrôle applicatif + fonction).

-- Tables en lecture seule pour l'application (écriture via fonctions contrôlées).
alter table immo.lot_status_history enable row level security;
create policy lsh_sel on immo.lot_status_history for select using (immo.in_org(org_id));
grant select on immo.lot_status_history to immo_app;

alter table immo.lot_holds enable row level security;
create policy holds_sel on immo.lot_holds for select using (immo.in_org(org_id));
grant select on immo.lot_holds to immo_app;

alter table immo.inquiries enable row level security;
create policy inquiries_sel on immo.inquiries for select using (immo.in_org(org_id));
grant select on immo.inquiries to immo_app;

alter table immo.jobs enable row level security;
create policy jobs_sel on immo.jobs for select using (immo.in_org(org_id));
create policy jobs_ins on immo.jobs for insert with check (immo.can_write(org_id, array['admin','project_manager','sales']) and created_by = immo.current_user_id());
grant select, insert on immo.jobs to immo_app;

alter table immo.audit_log enable row level security;
create policy audit_sel on immo.audit_log for select using (immo.in_org(org_id) and immo.has_role(org_id, array['admin']));
create policy audit_ins on immo.audit_log for insert with check (immo.in_org(org_id) and actor_id = immo.current_user_id());
grant select, insert on immo.audit_log to immo_app;
grant usage on sequence immo.audit_log_id_seq to immo_app;

-- Les propriétaires des tables (rôle de migration) ne sont pas soumis à la RLS ;
-- l'application n'utilise jamais ce rôle.
