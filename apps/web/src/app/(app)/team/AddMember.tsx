'use client';
import { useActionState } from 'react';
import { ROLES } from '@immo/core';
import { translator } from '@/lib/i18n';
import { addMember } from './actions';

export function AddMember() {
  const [state, run, pending] = useActionState(addMember, null);
  const t = translator('fr');
  return (
    <form action={run} className="stack">
      <label className="field"><span>E-mail</span><input name="email" type="email" required /></label>
      <label className="field"><span>Nom complet</span><input name="full_name" required /></label>
      <label className="field"><span>Rôle</span><select name="role" defaultValue="sales">{ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</select></label>
      <button className="btn btn-primary" disabled={pending}>Ajouter</button>
      {state && !state.ok && <div className="alert alert-error">{state.error}</div>}
      {state?.ok && (state.data?.tempPassword
        ? <div className="alert alert-success" role="status">Compte créé pour {state.data.email}. Mot de passe provisoire (affiché une seule fois, à transmettre par un canal sûr) : <code data-testid="temp-pw">{state.data.tempPassword}</code></div>
        : <div className="alert alert-success">Utilisateur existant ajouté à l’organisation.</div>)}
      <p className="small muted">Aucun e-mail d’invitation n’est envoyé (communications automatiques non configurées).</p>
    </form>
  );
}
