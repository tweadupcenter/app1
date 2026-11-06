import { requireSession } from '@/lib/auth';
import { getT } from '@/lib/locale';
import { publicTx } from '@/lib/db';
import { logoutAction, setLanguage, switchOrg } from '@/lib/actions-common';
import { NavLinks } from '@/components/NavLinks';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  const { t, locale } = await getT();
  const orgs = (await publicTx((x) => x.query('select * from immo.auth_user_orgs($1)', [s.tokenHash]))).rows;
  const links = [
    ['/dashboard', t('nav.dashboard')], ['/projects', t('nav.projects')], ['/lots', t('nav.lots')], ['/prospects', t('nav.prospects')],
    ['/agenda', t('nav.agenda')], ['/media', t('nav.media')], ['/team', t('nav.team')], ['/settings', t('nav.settings')],
  ];
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Navigation principale">
        <div className="brand"><span className="dot" />Tweadup Immo 360</div>
        <NavLinks links={links} />
        <div className="sep" />
        {orgs.length > 1 ? (
          <form action={switchOrg} className="stack" style={{ padding: '0 6px' }}>
            <label className="small" htmlFor="org">Organisation</label>
            <select id="org" name="org" defaultValue={s.orgId}>
              {orgs.map((o) => <option key={o.org_id} value={o.org_id}>{o.name}</option>)}
            </select>
            <button className="btn btn-sm">Changer</button>
          </form>
        ) : <div className="small" style={{ padding: '0 10px' }}>{s.orgName}</div>}
        <form action={setLanguage} className="row" style={{ padding: '8px 6px' }}>
          <button name="lang" value="fr" className={`btn btn-sm ${locale === 'fr' ? 'on' : ''}`}>FR</button>
          <button name="lang" value="ar" className={`btn btn-sm ${locale === 'ar' ? 'on' : ''}`}>العربية</button>
        </form>
        <div className="foot">
          <div style={{ color: '#fff' }}>{s.fullName}</div>
          <div>{t(`role.${s.role}`)}</div>
          <form action={logoutAction}><button className="btn btn-sm" style={{ marginTop: 6 }}>{t('nav.logout')}</button></form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
