import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('CRM : création, pipeline, interaction, rendez-vous, tâche ; tableau de bord calculé', async ({ page }) => {
  await login(page, 'commercial2@demo.example');
  const before = Number(await page.locator('[data-kpi="stage-interested"]').innerText());
  await page.goto('/prospects');
  await page.getByLabel('Nom complet').fill('Prospect CRM e2e (fictif)');
  await page.getByLabel('E-mail').last().fill('crm.e2e@example.com');
  await page.getByRole('button', { name: 'Créer' }).click();
  await page.waitForURL(/\/prospects\/[0-9a-f-]{36}$/);
  await page.getByLabel('Contenu').fill('Appel de qualification');
  await page.getByRole('button', { name: 'Ajouter' }).first().click();
  await expect(page.getByTestId('interactions')).toContainText('Appel de qualification');
  await page.getByTestId('stage').selectOption('interested');
  await page.getByRole('button', { name: 'Mettre à jour' }).click();
  await expect(page.getByTestId('interactions')).toContainText('new → interested');
  await page.getByRole('button', { name: 'Planifier' }).click();
  await expect(page.getByText('Rendez-vous planifié.')).toBeVisible();
  await page.goto('/dashboard');
  expect(Number(await page.locator('[data-kpi="stage-interested"]').innerText())).toBe(before + 1);
  // doublon détecté
  await page.goto('/prospects');
  await page.getByLabel('Nom complet').fill('Doublon');
  await page.getByLabel('E-mail').last().fill('crm.e2e@example.com');
  await page.getByRole('button', { name: 'Créer' }).click();
  await expect(page.getByText(/Doublon probable/)).toBeVisible();
});

test('équipe : un administrateur ajoute un membre ; un lecteur ne voit pas les notes privées', async ({ page }) => {
  await login(page, 'admin@demo.example');
  await page.goto('/team');
  await page.getByLabel('E-mail').fill('nouveau.e2e@demo.example');
  await page.getByLabel('Nom complet').fill('Nouveau Membre e2e');
  await page.getByLabel('Rôle').last().selectOption('viewer');
  await page.getByRole('button', { name: 'Ajouter' }).click();
  const pw = await page.getByTestId('temp-pw').innerText();
  expect(pw.length).toBeGreaterThan(10);
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail').fill('nouveau.e2e@demo.example');
  await page.getByLabel('Mot de passe').fill(pw);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.waitForURL(/dashboard/);
  await page.goto('/prospects?view=table');
  await page.getByRole('link', { name: 'Amine B. (fictif)' }).click();
  await expect(page.getByText('Note interne fictive')).toHaveCount(0);
  await page.goto('/team');
  await expect(page.getByRole('button', { name: 'Retirer' })).toHaveCount(0);
  await page.goto('/projects');
  await expect(page.getByText('Création réservée')).toBeVisible();
});

test('import CSV : aperçu, refus des doublons, enregistrement', async ({ page }) => {
  await login(page, 'chef.projet@demo.example');
  await page.goto('/lots');
  const csv = 'reference;type;pieces;surface_commerciale_m2;prix;statut\nZ-01;apartment;3;80;900000;available\nA-0-01;apartment;3;80;1;available\nZ-02;studio;1;30;400000;available\n';
  await page.locator('input[name=file]').setInputFiles({ name: 'lots.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Aperçu' }).click();
  await expect(page.getByTestId('csv-report')).toContainText('référence déjà existante');
  await expect(page.getByRole('button', { name: 'Enregistrer l’import' })).toBeDisabled();
  await page.locator('input[name=file]').setInputFiles({ name: 'lots.csv', mimeType: 'text/csv', buffer: Buffer.from(csv.replace('A-0-01;apartment;3;80;1;available\n', '')) });
  await page.getByRole('button', { name: 'Aperçu' }).click();
  await expect(page.getByTestId('csv-report')).toContainText('2 création(s)');
  await page.getByRole('button', { name: 'Enregistrer l’import' }).click();
  await expect(page.getByTestId('csv-report')).toContainText('Import enregistré : 2 ligne(s)');
  const exp = await page.request.get('/api/lots/export?q=Z-0');
  expect(await exp.text()).toContain('Z-01');
});
