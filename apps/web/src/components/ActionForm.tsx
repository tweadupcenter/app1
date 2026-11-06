'use client';
import { useActionState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/lib/errors';

type Act = (prev: ActionResult<any> | null, form: FormData) => Promise<ActionResult<any>>;

/** Formulaire relié à une Server Action : états en cours / succès / erreur, rafraîchissement. */
export function ActionForm({ action, children, className, resetOnSuccess, submitLabel, submitClass = 'btn btn-primary', confirm, redirectTo, inline }:
  { action: Act; children?: React.ReactNode; className?: string; resetOnSuccess?: boolean; submitLabel?: string; submitClass?: string; confirm?: string; redirectTo?: string; inline?: boolean }) {
  const [state, run, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) ref.current?.reset();
      const to = redirectTo && state.data ? redirectTo.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String((state.data as any)?.[k] ?? ''))) : null;
      if (to) router.push(to); else router.refresh();
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form ref={ref} action={run} className={className ?? (inline ? 'row' : 'stack')}
      onSubmit={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {children}
      {submitLabel && <div><button className={submitClass} disabled={pending}>{pending ? '…' : submitLabel}</button></div>}
      {state && !state.ok && <div className="alert alert-error" role="alert">{state.error}</div>}
      {state?.ok && state.message && <div className="alert alert-success" role="status">{state.message}</div>}
    </form>
  );
}
