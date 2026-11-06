import { LoginForm } from './LoginForm';
import { getSession } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Connexion' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  if (s?.orgId) redirect('/dashboard');
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>Tweadup Immo 360</h1>
        <p className="muted" style={{ marginTop: 0 }}>Espace promoteurs et agences</p>
        {sp.error === 'no_org' && <div className="alert alert-warning">Votre compte n’est rattaché à aucune organisation.</div>}
        <LoginForm next={sp.next} />
        {process.env.NODE_ENV !== 'production' && (
          <p className="small muted">Démo locale : admin@demo.example (mot de passe défini par SEED_PASSWORD).</p>
        )}
      </div>
    </div>
  );
}
