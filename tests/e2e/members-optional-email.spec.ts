import { test, expect } from '@playwright/test';

test('permite cadastrar e editar membros sem e-mail', async ({ page }) => {
  test.skip(!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD, 'Credenciais de teste indisponiveis');
  await page.goto('/login');
  await page.getByLabel('E-mail ou usuário').fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel('Senha').fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar no BlueScale' }).click();
  await expect(page.getByText('Uma escala mais justa.')).toBeVisible();

  await page.goto('/membros');
  await page.getByRole('button', { name: 'Novo membro' }).click();
  const emailInput = page.locator('#member-form input[type="email"]');
  await expect(emailInput).not.toHaveAttribute('required', '');
  await expect(page.locator('#member-form')).toContainText('E-mail (opcional)');

  const deps = await (await page.request.get('/api/departments')).json();
  const suffix = Date.now().toString(36);
  const payload = { identifier: 'noemail-' + suffix, fullName: 'Pessoa Sem Email', departmentId: deps[0].id };
  const first = await page.request.post('/api/members', { data: payload });
  expect(first.status()).toBe(201);
  const firstId = (await first.json()).id;
  const second = await page.request.post('/api/members', { data: { ...payload, identifier: 'noemail2-' + suffix, email: '' } });
  expect(second.status()).toBe(201);

  const listing = await (await page.request.get('/api/members?q=' + encodeURIComponent(payload.identifier))).json();
  expect(listing.data.find((m: { id: string; email: string | null }) => m.id === firstId)?.email).toBeNull();

  const withMail = await page.request.patch('/api/members/' + firstId, { data: { email: 'Teste' + suffix + '@example.com' } });
  expect(withMail.status()).toBe(200);
  const noMail = await page.request.patch('/api/members/' + firstId, { data: { email: '' } });
  expect(noMail.status()).toBe(200);
});
