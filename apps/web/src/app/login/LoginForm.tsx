'use client';
import { useActionState } from 'react';
import { loginAction } from '@/lib/actions-common';

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, {});
  return (
    <form action={formAction} className="stack" style={{ marginTop: 12 }}>
      <input type="hidden" name="next" value={next ?? '/dashboard'} />
      <label className="field"><span>E-mail</span><input name="email" type="email" autoComplete="username" required /></label>
      <label className="field"><span>Mot de passe</span><input name="password" type="password" autoComplete="current-password" required /></label>
      {state?.error && <div className="alert alert-error" role="alert">{state.error}</div>}
      <button className="btn btn-primary" disabled={pending}>{pending ? 'Connexion…' : 'Se connecter'}</button>
    </form>
  );
}
