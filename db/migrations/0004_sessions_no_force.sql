-- La table des sessions n'est accessible qu'au travers des fonctions auth_* (SECURITY DEFINER) :
-- le rôle applicatif n'a aucun droit dessus. Le « FORCE ROW LEVEL SECURITY » empêchait aussi
-- le propriétaire (non super-utilisateur, comme « postgres » sur Supabase) d'y écrire via ces fonctions.
alter table immo.sessions no force row level security;
