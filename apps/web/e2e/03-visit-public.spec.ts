import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

const SLUG = '/p/al-nakhil-demo';

async function waitScene(page: Page) {
  await expect(page.getByTestId('viewer')).toHaveAttribute('data-loaded', '1', { timeout: 90_000 });
  await page.waitForTimeout(1500);
}
async function clickLot(page: Page, ref: string) {
  const pt = await page.evaluate((r) => (window as any).__immoScene.screenOf(`lot_${r}`), ref);
  expect(pt, `lot ${ref} visible à l'écran`).not.toBeNull();
  await page.mouse.click(pt.x, pt.y);
}

test('visite publique : barre de navigation, clic sur un lot, fiche, comparaison', async ({ page }) => {
  await page.goto(SLUG);
  await waitScene(page);
  const nav = await page.getByTestId('vnav').locator('button').allInnerTexts();
  expect(nav).toEqual(['Vue générale', 'Piscine', 'Jardin', 'Sport', 'Parking', 'Bâtiment A', 'Bâtiment B', 'Bâtiment C']);
  // déplacement fluide vers une caméra enregistrée
  const before = await page.evaluate(() => (window as any).__immoScene.pose().position);
  await page.getByTestId('vnav').getByRole('button', { name: 'Piscine' }).click();
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => (window as any).__immoScene.pose().position);
  expect(Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2])).toBeGreaterThan(20);
  await page.getByTestId('vnav').getByRole('button', { name: 'Vue générale' }).click();
  await page.waitForTimeout(1800);
  // clic 3D -> bon lot -> bonne fiche
  await clickLot(page, 'A-2-02');
  await expect(page.getByTestId('lot-panel')).toHaveAttribute('data-lot', 'A-2-02');
  // comparaison : 3 lots maximum
  await page.getByTestId('compare-add').click();
  for (const r of ['A-2-03', 'A-2-01', 'A-2-04']) { await clickLot(page, r); await page.getByTestId('compare-add').click(); }
  await expect(page.getByTestId('compare').locator('th')).toHaveCount(1 + 3 + 7);
  await expect(page.getByText('Comparaison limitée à 3 lots.')).toBeVisible();
  await clickLot(page, 'A-2-02');
  await page.getByTestId('open-lot').click();
  await expect(page.getByTestId('public-lot-title')).toHaveText('A-2-02');
});

test('parcours caméra : lecture du parcours enregistré', async ({ page }) => {
  await page.goto(SLUG);
  await waitScene(page);
  const p0 = await page.evaluate(() => (window as any).__immoScene.pose().position);
  await page.getByTestId('tour').first().click();
  await page.waitForTimeout(6000);
  const p1 = await page.evaluate(() => (window as any).__immoScene.pose().position);
  expect(Math.hypot(p1[0] - p0[0], p1[2] - p0[2])).toBeGreaterThan(10);
});

test('affichage de secours sans WebGL', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error simulation d'un appareil sans WebGL
    HTMLCanvasElement.prototype.getContext = function (t: string, ...a: unknown[]) { return /webgl/.test(t) ? null : orig.call(this, t, ...a); };
  });
  const page = await ctx.newPage();
  await page.goto(SLUG);
  await expect(page.getByTestId('fallback')).toBeVisible();
  await expect(page.getByTestId('fallback')).toContainText('A-0-02');
  await ctx.close();
});

test('demande publique : crée un prospect sans réserver ; changement de statut répercuté', async ({ page }) => {
  await page.goto(SLUG);
  const card = page.getByTestId('public-lots').locator('.lot-card', { hasText: 'B-1-02' });
  await card.getByRole('link', { name: 'Voir la fiche' }).click();
  await page.getByLabel('Nom complet').fill('Visiteur E2E (fictif)');
  await page.getByLabel('E-mail').fill('visiteur.e2e@example.com');
  await page.getByRole('button', { name: 'Prendre rendez-vous' }).first().click();
  await page.getByLabel(/Créneau souhaité/).fill('2030-01-15T10:30');
  await page.getByLabel(/J’accepte/).check();
  await page.getByRole('button', { name: 'Envoyer' }).click();
  await expect(page.getByText(/Demande envoyée/)).toBeVisible();
  await expect(page.locator('[data-status]').first()).toHaveAttribute('data-status', 'available');
  // côté CRM
  await login(page, 'commercial@demo.example');
  await page.goto('/prospects?view=table&q=visiteur.e2e');
  await page.getByRole('link', { name: 'Visiteur E2E (fictif)' }).click();
  await expect(page.getByText('Nouveau · Site web', { exact: false })).toBeVisible();
  await expect(page.getByTestId('interactions')).toContainText('Demande de rendez-vous — lot B-1-02');
  await expect(page.getByText('demandé — à confirmer')).toBeVisible();
  // un chef de projet rend le lot indisponible -> visible publiquement
  await login(page, 'chef.projet@demo.example');
  await page.goto('/lots?q=B-1-02');
  await page.getByRole('link', { name: 'B-1-02' }).click();
  const panel = page.getByTestId('status-panel');
  await panel.locator('form', { hasText: 'Rendre indisponible' }).getByLabel('Motif (obligatoire)').fill('Test e2e');
  await panel.getByRole('button', { name: 'Rendre indisponible' }).click();
  await expect(panel.locator('[data-status]').first()).toHaveAttribute('data-status', 'unavailable');
  const st = await (await page.request.get(`/api/public/al-nakhil-demo/status`)).json();
  const lotId = page.url().split('/lots/')[1];
  expect(st[lotId]).toBe('unavailable');
  await page.goto(`${SLUG}/lots/${lotId}`);
  await expect(page.locator('[data-status]').first()).toHaveAttribute('data-status', 'unavailable');
});

test('WhatsApp : bouton affiché uniquement si un numéro est configuré, message prérempli', async ({ page }) => {
  await page.goto(SLUG);
  await expect(page.getByTestId('whatsapp')).toHaveCount(0);
  await login(page, 'admin@demo.example');
  await page.goto('/settings');
  await page.getByTestId('whatsapp-input').fill('+212 600 000 000');
  await page.getByRole('button', { name: 'Enregistrer' }).first().click();
  await expect(page.getByText(/Paramètres enregistrés/)).toBeVisible();
  const projects = await page.goto('/projects');
  void projects;
  await page.getByRole('link', { name: /Résidence Al Nakhil/ }).click();
  await page.getByRole('button', { name: 'Publier une nouvelle version' }).click({ trial: false }).catch(() => {});
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Publier une nouvelle version' }).click();
  await expect(page.getByText('Nouvelle version publiée.')).toBeVisible();
  await page.goto(SLUG);
  const href = await page.getByTestId('whatsapp').getAttribute('href');
  expect(href).toMatch(/^https:\/\/wa\.me\/212600000000\?text=Bonjour/);
});

test('administration des points de visite sans code', async ({ page }) => {
  await login(page, 'admin@demo.example');
  await page.goto('/projects');
  await page.getByRole('link', { name: /Résidence Al Nakhil/ }).click();
  await page.getByRole('link', { name: 'Visite interactive 3D' }).click();
  await waitScene(page);
  await page.getByTestId('vnav').getByRole('button', { name: 'Jardin' }).click();
  await page.waitForTimeout(1600);
  await page.getByTestId('vp-label').fill('Vue test e2e');
  await page.getByTestId('vp-save').click();
  await expect(page.getByText(/Point de vue enregistré/)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('vnav').getByRole('button', { name: 'Vue test e2e' })).toBeVisible({ timeout: 60_000 });
});
