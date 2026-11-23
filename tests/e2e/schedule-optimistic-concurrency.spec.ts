import { test, expect, type Page } from '@playwright/test';

// A regression for two independently authenticated browser sessions editing the
// same DRAFT. It uses only CI-created members/events and never touches production.
async function loginAsAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail ou usuário').fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel('Senha').fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar no BlueScale' }).click();
  await expect(page.getByText('Uma escala mais justa.')).toBeVisible();
}

test('two editors: stale revisions return 409 and simultaneous edits never overwrite one another', async ({ browser }) => {
  test.skip(!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD, 'Requires isolated CI admin credentials');
  test.setTimeout(90_000);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await Promise.all([loginAsAdmin(pageA), loginAsAdmin(pageB)]);

    const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const departmentsResponse = await ctxA.request.get('/api/departments');
    expect(departmentsResponse.status()).toBe(200);
    const departments = await departmentsResponse.json();
    expect(departments.length).toBeGreaterThan(0);

    const memberResponse = await ctxA.request.post('/api/members', { data: {
      identifier: 'concurrency' + token,
      fullName: 'Concurrency Test ' + token,
      email: 'concurrency' + token + '@example.test',
      departmentId: departments[0].id,
      preferredPeriod: 'ANY',
      skillIds: [],
    } });
    expect(memberResponse.status()).toBe(201);
    const memberId = (await memberResponse.json()).id as string;

    const start = new Date(Date.now() + 8 * 86400_000);
    start.setUTCHours(16, 0, 0, 0);
    const eventResponse = await ctxA.request.post('/api/events', { data: {
      name: 'Optimistic concurrency ' + token,
      location: 'CI only',
      description: 'Two distinct browser sessions; no production data',
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 3600_000).toISOString(),
      maxMinutesPerMember: 360,
      maxShiftsPerMember: 4,
      minRestMinutes: 0,
    } });
    expect(eventResponse.status()).toBe(201);
    const eventId = (await eventResponse.json()).id as string;
    const eventUrl = '/api/events/' + eventId;

    expect((await ctxA.request.post(eventUrl + '/workstations', { data: {
      name: 'Test desk', minPeople: 1, idealPeople: 1,
      slotMinutes: 60, priority: 1, skillIds: [],
    } })).status()).toBe(201);

    expect((await ctxA.request.post(eventUrl + '/availability', { data: {
      memberId, startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 3600_000).toISOString(),
      available: true,
    } })).status()).toBe(200);

    expect((await ctxA.request.post(eventUrl + '/schedule/generate', { data: {} })).status()).toBe(200);

    const scheduleUrl = eventUrl + '/schedule';
    const editUrl = scheduleUrl + '/edit';
    const [aResponse, bResponse] = await Promise.all([
      ctxA.request.get(scheduleUrl), ctxB.request.get(scheduleUrl),
    ]);
    expect(aResponse.status()).toBe(200);
    expect(bResponse.status()).toBe(200);
    const versionA = await aResponse.json();
    const versionB = await bResponse.json();
    expect(versionB.id).toBe(versionA.id);
    expect(versionB.revision).toBe(versionA.revision);
    expect(versionA.assignments).toHaveLength(1);
    const shiftId = versionA.assignments[0].shiftId as string;

    // Editor A locks the assignment. B submits its stale snapshot.
    const lock = await ctxA.request.post(editUrl, { data: {
      versionId: versionA.id, revision: versionA.revision,
      operation: 'lock', memberId, shiftId,
    } });
    expect(lock.status()).toBe(200);
    expect((await lock.json()).revision).toBe(versionA.revision + 1);

    const stale = await ctxB.request.post(editUrl, { data: {
      versionId: versionB.id, revision: versionB.revision,
      operation: 'unassign', memberId, shiftId,
    } });
    expect(stale.status()).toBe(409);
    const afterStale = await (await ctxA.request.get(scheduleUrl)).json();
    expect(afterStale.revision).toBe(versionA.revision + 1);
    expect(afterStale.assignments).toHaveLength(1);
    expect(afterStale.assignments[0].locked).toBe(true);

    // Unlock, then race two *valid* operations from the same revision.
    const unlock = await ctxA.request.post(editUrl, { data: {
      versionId: versionA.id, revision: afterStale.revision,
      operation: 'unlock', memberId, shiftId,
    } });
    expect(unlock.status(), 'Unlock response: ' + await unlock.text()).toBe(200);
    const unlockedRevision = (await unlock.json()).revision as number;
    const [racedLock, racedUnassign] = await Promise.all([
      ctxA.request.post(editUrl, { data: {
        versionId: versionA.id, revision: unlockedRevision,
        operation: 'lock', memberId, shiftId,
      } }),
      ctxB.request.post(editUrl, { data: {
        versionId: versionA.id, revision: unlockedRevision,
        operation: 'unassign', memberId, shiftId,
      } }),
    ]);
    expect([racedLock.status(), racedUnassign.status()].sort((a, b) => a - b)).toEqual([200, 409]);

    const finalState = await (await ctxA.request.get(scheduleUrl)).json();
    expect(finalState.revision).toBe(unlockedRevision + 1);
    if (racedLock.status() === 200) {
      expect(finalState.assignments).toHaveLength(1);
      expect(finalState.assignments[0].locked).toBe(true);
    } else {
      expect(finalState.assignments).toHaveLength(0);
    }
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
