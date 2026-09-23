import { expect, test, type Page } from '@playwright/test';

async function enroll(page: Page, user = 'ibanda', pw = 'ibanda2026') {
  await page.goto('/');
  await page.getByLabel('Identifiant').fill(user);
  await page.getByLabel('Mot de passe').fill(pw);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: "Connecter l'appareil" }).click();
  await expect(page.getByText('Qui êtes-vous ?')).toBeVisible({ timeout: 30_000 });
}

async function pin(page: Page, who: RegExp, code: string) {
  await page.getByRole('button', { name: who }).click();
  for (const d of code) await page.getByRole('button', { name: d, exact: true }).click();
  await expect(page.getByText('Les plus vendus ici')).toBeVisible();
}

test('installable PWA that sells, shares a receipt and sends a transfer with the network off, then syncs', async ({ page, context }) => {
  // Record what would be shared to WhatsApp instead of opening the share sheet.
  await page.addInitScript(() => {
    (window as any).__shared = [];
    (navigator as any).canShare = () => true;
    (navigator as any).share = async (d: any) => (window as any).__shared.push({ text: d.text, files: (d.files ?? []).map((f: File) => f.name) });
  });

  await enroll(page);

  // PWA: manifest and an active service worker controlling the page.
  const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
  expect(manifest.display).toBe('standalone');
  expect(manifest.lang).toBe('fr');
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready).active, null, { timeout: 30_000 });
  await page.reload(); // now controlled by the service worker
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  // Cut the network completely and reload: the app must still open.
  await context.setOffline(true);
  await page.reload();
  await pin(page, /Grâce Mapendo/, '1234');
  await expect(page.getByText('Les plus vendus ici')).toBeVisible();
  await expect(page.locator('.sync')).toContainText('Hors ligne');

  // Checkout in 3 taps: product, "Encaisser", payment method.
  await page.locator('.list .item').first().click(); // tap 1
  await page.getByRole('button', { name: /^Encaisser/ }).click(); // tap 2
  await page.getByRole('button', { name: 'Espèces $' }).click(); // tap 3
  await expect(page.getByText('Vente enregistrée.')).toBeVisible();
  await expect(page.locator('.sync')).toContainText('Hors ligne · 1');

  // Share the receipt as an image while offline.
  await page.getByRole('button', { name: /Partager le reçu/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__shared.length)).toBe(1);
  const shared = await page.evaluate(() => (window as any).__shared[0]);
  expect(shared.files[0]).toMatch(/^recu-IBA-.*\.png$/);
  expect(shared.text).toContain('TOTAL');

  // A manager sends a transfer while offline.
  await page.getByRole('button', { name: "Changer d'utilisateur" }).first().click();
  await pin(page, /Espoir Bisimwa/, '2222');
  await page.goto('/#/transfer/new');
  await page.getByPlaceholder('Ajouter un article : nom ou référence').fill('bougie D8EA');
  await page.locator('.list .item').filter({ hasText: 'D8EA' }).first().click();
  await page.getByRole('button', { name: "Confirmer l'envoi" }).click();
  await expect(page.getByText('En route : le magasin destinataire doit confirmer la réception.')).toBeVisible();
  await expect(page.locator('.sync')).toContainText('Hors ligne · 2');

  // Network back: everything is sent and the badge returns to "À jour".
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.sync')).toContainText('À jour', { timeout: 20_000 });
  const pending = await page.evaluate(async () => {
    const r = await new Promise<IDBDatabase>((res) => {
      const o = indexedDB.open('interdiesel');
      o.onsuccess = () => res(o.result);
    });
    return await new Promise<number>((res) => {
      const q = r.transaction('outbox').objectStore('outbox').count();
      q.onsuccess = () => res(q.result);
    });
  });
  expect(pending).toBe(0);
});

test('a seller cannot see store reports or stock adjustments', async ({ page }) => {
  await enroll(page, 'kadutu', 'kadutu2026');
  await pin(page, /Olivier Mugisho/, '1234');
  await page.goto('/#/reports');
  await expect(page.getByRole('heading', { name: 'Mes ventes du jour' })).toBeVisible();
  await page.goto('/#/menu');
  await expect(page.getByText('Ajustement de stock')).toHaveCount(0);
  await expect(page.getByText('Journal des modifications')).toHaveCount(0);
});
