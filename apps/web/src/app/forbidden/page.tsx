import Link from 'next/link';
export default function Forbidden() {
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>Autorisation insuffisante</h1>
        <p>Votre rôle ne permet pas d’accéder à cette page. Contactez un administrateur de votre organisation si vous pensez que c’est une erreur.</p>
        <Link className="btn" href="/dashboard">Retour au tableau de bord</Link>
      </div>
    </div>
  );
}
