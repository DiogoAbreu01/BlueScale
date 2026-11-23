import { test, expect, type Page } from '@playwright/test';

/**
 * Server-enforced authorization regression: a coordinator can read only
 * explicitly nominated events, and revocation takes effect without re-login.
 * All data and credentials are synthetic, created in the ephemeral CI DB.
 */
async function login(page: Page, identifier: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('E-mail ou usuário').fill(identifier);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar no BlueScale' }).click();
  await expect(page.getByText('Uma escala mais justa.')).toBeVisible();
}

test('coordinator cannot cross event boundaries; revocation invalidates existing session', async ({ browser }) => {
  test.skip(!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD, 'Requires isolated CI administrator');
  test.setTimeout(90_000);

  const adminContext = await browser.newContext();
  const coordinatorContext = await browser.newContext();

  try {
    const adminPage = await adminContext.newPage();
    await login(adminPage, process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);

    const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const startsAt = new Date(Date.now() + 9 * 86_400_000);
    startsAt.setUTCHours(14, 0, 0, 0);
    const eventInput = {
      description: 'Authorization isolation CI fixture',
      location: 'CI test only',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
      maxMinutesPerMember: 360,
      maxShiftsPerMember: 4,
      minRestMinutes: 0,
    };

    const createEvent = async (tag: string) => {
      const res = await adminContext.request.post('/api/events', {
        data: { ...eventInput, name: 'Coordinator boundary ' + tag + ' ' + token },
      });
      expect(res.status()).toBe(201);
      return (await res.json()).id as string;
    };
    const eventA = await createEvent('AUTHORIZED');
    const eventB = await createEvent('PRIVATE');

    const username = 'coord' + token;
    const password = 'Coordinator#2026' + token + '!';
    const created = await adminContext.request.post('/api/users', { data: {
      name: 'Coordinator CI ' + token, username, email: '',
      role: 'EVENT_COORDINATOR', password,
    } });
    expect(created.status()).toBe(201);
    const userId = (await created.json()).id as string;

    // The extra role does not grant global access before nomination.
    const coordinatorPage = await coordinatorContext.newPage();
    await login(coordinatorPage, username, password);
    expect((await coordinatorContext.request.get('/api/events/' + eventA)).status()).toBe(403);
    expect((await coordinatorContext.request.get('/api/events/' + eventB)).status()).toBe(403);

    const nominated = await adminContext.request.post('/api/events/' + eventA + '/coordinators', {
      data: { userId },
    });
    expect(nominated.status()).toBe(200);
    expect((await nominated.json()).accessGranted).toBe(true);

    const scopedList = await coordinatorContext.request.get('/api/events');
    expect(scopedList.status()).toBe(200);
    const scopedEvents = await scopedList.json();
    expect(scopedEvents.some((e: { id: string }) => e.id === eventA)).toBe(true);
    expect(scopedEvents.some((e: { id: string }) => e.id === eventB)).toBe(false);

    expect((await coordinatorContext.request.get('/api/events/' + eventA)).status()).toBe(200);
    expect((await coordinatorContext.request.get('/api/events/' + eventB)).status()).toBe(403);
    expect((await coordinatorContext.request.get('/api/events/' + eventB + '/schedule')).status()).toBe(403);
    expect((await coordinatorContext.request.get('/api/events/' + eventB + '/export')).status()).toBe(403);
    expect((await coordinatorContext.request.get('/api/events/' + eventB + '/export/csv')).status()).toBe(403);

    // A valid assignment permits reading the event, not managing unrelated resources.
    expect((await coordinatorContext.request.get('/api/events/' + eventA + '/schedule')).status()).toBe(404);
    expect((await coordinatorContext.request.get('/api/users')).status()).toBe(403);
    expect((await coordinatorContext.request.post('/api/events', { data: eventInput })).status()).toBe(403);
    expect((await coordinatorContext.request.post('/api/events/' + eventA + '/workstations', {
      data: { name: 'Forbidden', minPeople: 1, idealPeople: 1, slotMinutes: 60, priority: 1, skillIds: [] },
    })).status()).toBe(403);

    const membersResponse = await coordinatorContext.request.get('/api/members');
    expect(membersResponse.status()).toBe(200);
    const membersData = await membersResponse.json();
    for (const member of membersData.data as Array<Record<string, unknown>>) {
      expect(member).not.toHaveProperty('email');
      expect(member).not.toHaveProperty('commute');
      expect(member).not.toHaveProperty('preference');
    }

    // Authorization must be consulted against the live DB, not a stale session role.
    const revoked = await adminContext.request.delete('/api/events/' + eventA + '/coordinators', {
      data: { userId },
    });
    expect(revoked.status()).toBe(200);

    expect((await coordinatorContext.request.get('/api/events/' + eventA)).status()).toBe(403);
    expect((await coordinatorContext.request.get('/api/events/' + eventA + '/export/csv')).status()).toBe(403);
    const afterRevocation = await (await coordinatorContext.request.get('/api/events')).json();
    expect(afterRevocation.some((e: { id: string }) => e.id === eventA)).toBe(false);
  } finally {
    await adminContext.close();
    await coordinatorContext.close();
  }
});
