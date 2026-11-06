// Traduction des erreurs de la base en messages compréhensibles (sans détails internes).
const MESSAGES: Record<string, string> = {
  lot_not_available: 'Ce lot n’est plus disponible : un autre engagement a été posé entre-temps.',
  lot_not_found: 'Lot introuvable.',
  prospect_not_found: 'Prospect introuvable.',
  forbidden: 'Autorisation insuffisante.',
  forbidden_transition: 'Ce changement de statut est réservé aux administrateurs et chefs de projet.',
  invalid_transition: 'Transition de statut non autorisée (un lot doit être réservé avant d’être vendu).',
  reason_required: 'Un motif est obligatoire.',
  use_hold_lot: 'Utilisez « Poser une option » ou « Réserver ».',
  invalid_duration: 'Durée d’option invalide (5 minutes à 30 jours).',
  idempotency_key_conflict: 'Requête dupliquée incohérente.',
  idempotency_key_required: 'Requête invalide.',
  status_requires_function: 'Le statut se modifie depuis la fiche du lot.',
  last_admin: 'L’organisation doit conserver au moins un administrateur.',
  consent_required: 'Merci d’accepter d’être recontacté(e).',
  contact_required: 'Indiquez un e-mail ou un téléphone.',
  invalid_name: 'Nom invalide.',
  publication_not_found: 'Cette présentation n’est plus publiée.',
  lot_not_published: 'Ce lot n’est pas publié.',
  invalid_role: 'Rôle invalide.',
};

export function dbErrorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string; constraint?: string };
  const msg = err?.message ?? '';
  for (const [k, v] of Object.entries(MESSAGES)) if (msg.includes(k)) return v;
  if (err?.code === '23505') return 'Cette valeur existe déjà (doublon).';
  if (err?.code === '42501' || /row-level security/.test(msg)) return 'Autorisation insuffisante.';
  if (err?.code === '23503') return 'Élément lié introuvable.';
  if (err?.code === '23514' || err?.code === '22P02') return 'Valeur invalide.';
  console.error('[db]', err?.code, msg.slice(0, 300));
  return 'Une erreur est survenue. Réessayez ou contactez un administrateur.';
}

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

export async function action<T>(fn: () => Promise<T>, okMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: okMessage };
  } catch (e) {
    const he = e as { status?: number; message?: string };
    if (he?.status && he.message) return { ok: false, error: he.message };
    if (e instanceof UserError) return { ok: false, error: e.message };
    return { ok: false, error: dbErrorMessage(e) };
  }
}

export class UserError extends Error {}
