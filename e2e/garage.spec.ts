import { expect, test, type Browser } from '@playwright/test';

async function login(browser: Browser, user: string, pw: string, who: RegExp, code: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.getByLabel('Identifiant').fill(user);
  await page.getByLabel('Mot de passe').fill(pw);
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: "Connecter l'appareil" }).click();
  await expect(page.getByText('Qui êtes-vous ?')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: who }).click();
  for (const d of code) await page.getByRole('button', { name: d, exact: true }).click();
  await expect(page.locator('.topbar')).toBeVisible();
  return page;
}

test('garage: arrival with checklist, a shop hands out the parts, the chief invoices on account', async ({ browser }) => {
  const garage = await login(browser, 'garage', 'garage2026', /Jean-Marie/, '7777');
  await expect(garage.getByRole('heading', { name: 'Atelier' })).toBeVisible();

  // arrival of a new vehicle
  await garage.getByRole('link', { name: 'Nouvelle entrée' }).click();
  await garage.getByLabel("Plaque d'immatriculation").fill('CGO 2026 E2');
  await garage.getByLabel('Marque').fill('Toyota');
  await garage.getByLabel('Modèle').fill('Hilux');
  await garage.getByLabel('Demande du client / panne signalée').fill('Freins avant');
  await garage.getByRole('button', { name: 'Roue de secours' }).click();
  await garage.getByRole('button', { name: "Enregistrer l'entrée" }).click();
  await expect(garage.getByText('Entrée enregistrée')).toBeVisible();

  // mechanic's check + parts needed from Ibanda
  await garage.getByRole('tab', { name: 'Contrôle' }).click();
  await garage.getByRole('group', { name: 'Plaquettes avant' }).getByRole('button', { name: 'À réparer' }).click();
  await expect(garage.getByText(/1 \/ 36 points contrôlés · 1 à réparer/)).toBeVisible();
  await garage.getByRole('tab', { name: 'Travaux et pièces' }).click();
  await garage.getByPlaceholder('Ajouter un article').fill('04465-0K240');
  await garage.getByRole('button', { name: /Plaquettes de frein avant/ }).click();
  await garage.getByLabel('Fournie par').selectOption('st_ibanda');
  await garage.getByLabel('Ajouter un travail du catalogue').selectOption({ label: 'Plaquettes de frein avant · $20.00' });
  await garage.getByRole('button', { name: 'Enregistrer les travaux' }).click();
  await expect(garage.getByText('1 en attente')).toBeVisible();

  // Ibanda prepares the bon de sortie
  const shop = await login(browser, 'ibanda', 'ibanda2026', /Espoir/, '2222');
  await expect(async () => {
    await shop.goto('/#/issues');
    await shop.reload();
    await expect(shop.getByRole('link', { name: /CGO 2026 E2/ })).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  await shop.getByRole('link', { name: /CGO 2026 E2/ }).click();
  await shop.getByLabel('Nom de la personne qui emporte les pièces').fill('Faustin Bahati');
  await shop.getByRole('button', { name: 'Valider le bon de sortie' }).click();
  await expect(shop.getByText(/Bon de sortie IBA-BS-.* : le stock a été mis à jour/)).toBeVisible();

  // the garage sees the part arrive, invoices on the customer's account
  await expect(async () => {
    await garage.reload();
    await garage.getByRole('tab', { name: 'Travaux et pièces' }).click();
    await expect(garage.getByText('1 reçue(s)')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await garage.getByRole('tab', { name: 'Devis et facture' }).click();
  await garage.getByRole('button', { name: /^Facturer/ }).click();
  await garage.getByLabel('Mode de paiement').selectOption('cash');
  await garage.getByRole('button', { name: 'Le reste' }).click();
  await garage.getByRole('button', { name: 'Valider la facture' }).click();
  await expect(garage.getByText(/Facture GAR-FG-.* enregistrée/)).toBeVisible();
});
