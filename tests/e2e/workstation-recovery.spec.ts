import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';

async function login(page: import('@playwright/test').Page) {
 await page.goto('/login');
 await page.getByLabel('E-mail ou usuário').fill(process.env.ADMIN_EMAIL!);
 await page.getByLabel('Senha').fill(process.env.ADMIN_PASSWORD!);
 await page.getByRole('button', { name: 'Entrar no BlueScale' }).click();
 await expect(page.getByText('Uma escala mais justa.')).toBeVisible();
}

async function eventWithPost(page: import('@playwright/test').Page) {
 const token=Date.now().toString(36)+Math.random().toString(36).slice(2,5);
 const start=new Date(Date.now()+6*86400000);start.setUTCHours(13,0,0,0);
 const event=await page.request.post('/api/events',{data:{
  name:'Recuperacao Posto E2E '+token,location:'Laboratorio',
  startsAt:start.toISOString(),endsAt:new Date(start.getTime()+120*60000).toISOString(),
  maxMinutesPerMember:360,maxShiftsPerMember:4,minRestMinutes:0
 }});
 expect(event.status()).toBe(201);
 const id=(await event.json()).id as string;
 const post=await page.request.post('/api/events/'+id+'/workstations',{data:{
  name:'Posto Original',minPeople:1,idealPeople:1,slotMinutes:60,priority:1,skillIds:[]
 }});
 expect(post.status()).toBe(201);
 return {id,postId:(await post.json()).id as string};
}

test('recupera um posto removido sem apagar turnos e permite criar, editar e excluir depois de gerar',async({page})=>{
 test.skip(!process.env.ADMIN_EMAIL||!process.env.ADMIN_PASSWORD,'Credenciais de teste ausentes');
 await login(page);
 const {id,postId}=await eventWithPost(page);
 const before=await (await page.request.get('/api/events/'+id)).json();
 const shiftIds=before.shifts.map((s:{id:string})=>s.id).sort();
 expect((await page.request.post('/api/events/'+id+'/schedule/generate',{data:{}})).status()).toBe(200);
 expect((await page.request.delete('/api/events/'+id+'/workstations/'+postId)).status()).toBe(200);
 await page.goto('/eventos/'+id);
 await expect(page.getByText('Nenhum posto cadastrado.')).toBeVisible();
 const form=page.locator('#workstation-form');
 await expect(form).toBeVisible();
 const removed=page.locator('details').filter({hasText:'Postos removidos'});
 await removed.locator('summary').click();
 await expect(removed.getByText('Posto Original')).toBeVisible();
 page.once('dialog',dialog=>void dialog.accept());
 await removed.getByRole('button',{name:'Restaurar'}).click();
 await expect(page.getByText(/Posto "Posto Original" restaurado/)).toBeVisible();
 const restored=await (await page.request.get('/api/events/'+id)).json();
 expect(restored.shifts.map((s:{id:string})=>s.id).sort()).toEqual(shiftIds);
 page.once('dialog',dialog=>void dialog.accept());
 await page.getByRole('button',{name:'Excluir'}).click();
 await expect(page.getByText('Nenhum posto cadastrado.')).toBeVisible();
 await form.getByLabel('Nome do posto').fill('Posto Novo');
 await form.getByRole('button',{name:'Criar posto e turnos'}).click();
 await expect(page.getByText(/turnos criados no posto Posto Novo/)).toBeVisible();
 const created=await (await page.request.get('/api/events/'+id)).json();
 expect(created.workstations).toHaveLength(1);
 expect(created.workstations[0].name).toBe('Posto Novo');
 await page.getByRole('button',{name:'Editar'}).click();
 await expect(form).toBeVisible();
 await form.getByLabel('Nome do posto').fill('Posto Revisado');
 await form.getByRole('button',{name:'Salvar alterações'}).click();
 await expect(page.getByText(/Posto atualizado/)).toBeVisible();
 const edited=await (await page.request.get('/api/events/'+id)).json();
 expect(edited.workstations[0].name).toBe('Posto Revisado');
 page.once('dialog',dialog=>void dialog.accept());
 await page.getByRole('button',{name:'Excluir'}).click();
 await expect(page.getByText('Nenhum posto cadastrado.')).toBeVisible();
});

test('criar posto após publicar preserva a versão publicada e não inclui postos novos no Excel antigo',async({page})=>{
 test.skip(!process.env.ADMIN_EMAIL||!process.env.ADMIN_PASSWORD,'Credenciais de teste ausentes');
 await login(page);
 const {id,postId}=await eventWithPost(page);
 const result=await page.request.post('/api/events/'+id+'/schedule/generate',{data:{}});
 expect(result.status()).toBe(200);
 const draft=await (await page.request.get('/api/events/'+id+'/schedule')).json();
 expect((await page.request.post('/api/events/'+id+'/schedule/publish',{data:{
  versionId:draft.id,revision:draft.revision,acceptIncomplete:true
 }})).status()).toBe(200);
 expect((await page.request.delete('/api/events/'+id+'/workstations/'+postId)).status()).toBe(200);
 await page.goto('/eventos/'+id);
 await expect(page.locator('#workstation-form')).toBeVisible();
 const form=page.locator('#workstation-form');
 await form.getByLabel('Nome do posto').fill('Novo Após Publicar');
 await form.getByRole('button',{name:'Criar posto e turnos'}).click();
 await expect(page.getByText(/turnos criados no posto Novo Após Publicar/)).toBeVisible();
 const current=await (await page.request.get('/api/events/'+id)).json();
 expect(current.status).toBe('PUBLISHED');
 expect(current.workstations.some((w:{name:string})=>w.name==='Novo Após Publicar')).toBe(true);
 const published=await (await page.request.get('/api/events/'+id+'/schedule?view=published')).json();
 expect(published.id).toBe(draft.id);
 const excel=await page.request.get('/api/events/'+id+'/export');
 expect(excel.status()).toBe(200);
 const wb=new ExcelJS.Workbook();
 await wb.xlsx.load(Buffer.from(await excel.body()) as unknown as Parameters<typeof wb.xlsx.load>[0]);
 const stationRows=wb.getWorksheet('Escala por Posto');
 expect(stationRows).toBeTruthy();
 const names:string[]=[];
 stationRows?.eachRow(row=>names.push(String(row.getCell(1).value||'')));
 expect(names.some(name=>name.includes('Novo Após Publicar'))).toBe(false);
 const regen=await page.request.post('/api/events/'+id+'/schedule/generate',{data:{}});
 expect(regen.status()).toBe(200);
 const after=await (await page.request.get('/api/events/'+id)).json();
 expect(after.status).toBe('PUBLISHED');
 expect((await (await page.request.get('/api/events/'+id+'/schedule?view=published')).json()).id).toBe(draft.id);
});
