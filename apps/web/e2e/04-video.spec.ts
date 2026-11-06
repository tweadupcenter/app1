import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { login } from './helpers';

test.setTimeout(600_000);

test('éditeur vidéo : séquence 9:16, export MP4 réel vérifié par ffprobe', async ({ page }) => {
  await login(page, 'commercial@demo.example');
  await page.goto('/media');
  await page.getByLabel('Nom').fill('Test e2e vertical');
  await page.getByLabel('Format').selectOption('9:16');
  await page.getByRole('button', { name: 'Créer' }).click();
  await page.waitForURL(/\/media\/sequences\//);
  for (const vp of ['Vue générale', 'Piscine']) {
    await page.getByTestId('add-vp').selectOption({ label: vp });
    await page.getByTestId('add-shot').click();
  }
  const rows = page.getByTestId('shots').locator('tbody tr');
  await expect(rows).toHaveCount(2);
  for (let i = 0; i < 2; i++) await rows.nth(i).locator('input[type=number]').fill('1');
  await page.getByTestId('resolution').selectOption('720p');
  await page.getByLabel('Titre', { exact: true }).fill('Titre e2e');
  await page.getByTestId('save-seq').click();
  await expect(page.getByText('Séquence enregistrée.')).toBeVisible();
  await page.getByTestId('preview').click();
  await page.getByTestId('export').click();
  await expect(page.getByText(/Export ajouté à la file/)).toBeVisible();
  await expect(page.locator('[data-job-status="done"], [data-job-status="error"]').first()).toBeVisible({ timeout: 480_000 });
  await expect(page.locator('[data-job-status="error"]')).toHaveCount(0);
  const href = await page.getByRole('link', { name: 'Télécharger le MP4' }).first().getAttribute('href');
  const res = await page.request.get(href!);
  expect(res.ok()).toBe(true);
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'e2e-video-')), 'out.mp4');
  writeFileSync(file, await res.body());
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration', '-of', 'json', file]).toString());
  expect(probe.streams[0]).toMatchObject({ codec_name: 'h264', width: 720, height: 1280 });
  expect(Number(probe.format.duration)).toBeGreaterThan(1.8);
  expect(Number(probe.format.duration)).toBeLessThan(2.25);
  // une image décodable au milieu
  execFileSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-f', 'null', '-']);
});
