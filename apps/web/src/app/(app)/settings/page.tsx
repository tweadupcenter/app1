import { can, formatDateTime } from '@immo/core';
import { unrealConfigFromEnv } from '@immo/core/unreal';
import { asUser } from '@/lib/auth';
import { PageHead } from '@/components/ui';
import { ActionForm } from '@/components/ActionForm';
import { Uploader } from '@/components/Uploader';
import { saveOrgSettings } from './actions';

export const metadata = { title: 'Paramètres' };

export default async function Settings() {
  const d = await asUser(async (x, s) => ({
    role: s.role,
    org: (await x.query(`select * from immo.organizations where id=$1`, [s.orgId])).rows[0],
    audit: s.role === 'admin' ? (await x.query(`select a.*, u.full_name from immo.audit_log a left join immo.users u on u.id=a.actor_id order by a.id desc limit 30`)).rows : [],
  }));
  const admin = can(d.role, 'manageOrg');
  const unreal = unrealConfigFromEnv(process.env);
  const { org } = d;
  return (
    <>
      <PageHead title="Paramètres" subtitle="Organisation, identité visuelle, contact et intégrations" />
      <div className="grid grid-2">
        <section className="card">
          <h2>Organisation et identité visuelle</h2>
          {admin ? <ActionForm action={saveOrgSettings} className="stack" submitLabel="Enregistrer">
            <label className="field"><span>Nom</span><input name="name" defaultValue={org.name} required /></label>
            <label className="field"><span>Couleur principale</span><input name="primary_color" type="color" defaultValue={org.branding?.primary_color ?? '#1f4e5f'} /></label>
            <label className="field"><span>Téléphone affiché</span><input name="phone" defaultValue={org.contact?.phone ?? ''} /></label>
            <label className="field"><span>E-mail de contact</span><input name="email" type="email" defaultValue={org.contact?.email ?? ''} /></label>
            <label className="field"><span>Numéro WhatsApp (format international)</span><input name="whatsapp" defaultValue={org.contact?.whatsapp ?? ''} placeholder="+2126…" data-testid="whatsapp-input" /></label>
            <label className="field"><span>Adresse</span><input name="address" defaultValue={org.contact?.address ?? ''} /></label>
          </ActionForm> : <p className="muted">Réservé aux administrateurs.</p>}
          {admin && <div style={{ marginTop: 10 }}><Uploader purpose="logo" accept="image/png,image/jpeg" label="Logo (PNG/JPG, 2 Mo)" />{org.branding?.logo_media_id && <img src={`/api/files/${org.branding.logo_media_id}`} alt="Logo actuel" style={{ height: 40, marginTop: 6 }} />}</div>}
        </section>
        <div className="stack" style={{ gap: 14 }}>
          <section className="card">
            <h2>Localisation</h2>
            <dl className="kv"><dt>Langue par défaut</dt><dd>Français (arabe disponible, affichage RTL)</dd><dt>Devise</dt><dd>MAD (dirham marocain)</dd><dt>Surfaces</dt><dd>m²</dd><dt>Fuseau horaire</dt><dd>Africa/Casablanca</dd></dl>
          </section>
          <section className="card">
            <h2>Communications automatiques</h2>
            <label className="check"><input type="checkbox" disabled checked={false} readOnly /> <span>Envoi automatique d’e-mails / SMS / WhatsApp</span></label>
            <p className="small muted">Désactivé et non configurable : aucun fournisseur d’envoi n’est configuré ni autorisé. La plateforme n’envoie aucun message ; les boutons ouvrent la messagerie de l’utilisateur.</p>
          </section>
          <section className="card">
            <h2>Assistance IA à la lecture des plans</h2>
            <p className="small">Désactivée. Aucun plan n’est transmis à un fournisseur externe. La détection de traits proposée dans l’éditeur s’exécute localement dans le navigateur.</p>
          </section>
          <section className="card">
            <h2>Mode Unreal Engine</h2>
            <div className="alert alert-warning small">Non opérationnel : {unreal.missing.length} prérequis manquant(s).</div>
            <ul className="small">{unreal.missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </section>
        </div>
        {admin && <section className="card" style={{ gridColumn: '1 / -1' }}>
          <h2>Journal d’audit (30 derniers)</h2>
          <table className="table small"><tbody>{d.audit.map((a) => <tr key={a.id}><td className="nowrap">{formatDateTime(a.created_at)}</td><td>{a.full_name ?? '—'}</td><td>{a.action}</td><td className="mono">{JSON.stringify(a.meta)}</td></tr>)}</tbody></table>
        </section>}
      </div>
    </>
  );
}
