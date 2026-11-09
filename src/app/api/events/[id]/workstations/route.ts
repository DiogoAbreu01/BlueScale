import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { STAFF, fail, ok, requireRole, jsonBody, HttpError, sameOrigin } from '@/lib/api';
import { workstationSchema } from '@/lib/schemas';

type Context = { params: Promise<{id:string}> };

// Retired posts keep their shifts and historical attendance; only staff can see them.
export async function GET(_req:NextRequest,{params}:Context) {
 try {
  await requireRole(STAFF);
  const {id}=await params;
  const data=await prisma.workstation.findMany({
   where:{eventId:id,archivedAt:{not:null}},
   select:{id:true,name:true,minPeople:true,idealPeople:true,slotMinutes:true,archivedAt:true},
   orderBy:{name:'asc'}
  });
  return ok({data});
 }catch(e){return fail(e);}
}

export async function POST(req:NextRequest,{params}:Context) {
 try {
  const actor=await requireRole(STAFF);
  const {id}=await params;
  const data=workstationSchema.parse(await jsonBody(req));
  const result=await prisma.$transaction(async tx=>{
   const event=await tx.event.findUnique({where:{id}});
   if(!event)throw new HttpError(404,'Evento não encontrado');
   if(['COMPLETED','CANCELLED'].includes(event.status))throw new HttpError(409,'Evento encerrado; não é possível cadastrar novos postos.');
   const archived=await tx.workstation.findFirst({
    where:{eventId:id,name:data.name,archivedAt:{not:null}},select:{id:true}
   });
   if(archived)throw new HttpError(409,'Este posto já existe entre os removidos. Use Restaurar para recuperar o posto e o histórico.');
   const slotCount=Math.ceil((event.endsAt.getTime()-event.startsAt.getTime())/(data.slotMinutes*60000));
   if(slotCount>200)throw new HttpError(400,'Máximo de 200 turnos por posto.');
   const w=await tx.workstation.create({data:{
    eventId:id,name:data.name,description:data.description,
    minPeople:data.minPeople,idealPeople:data.idealPeople,
    slotMinutes:data.slotMinutes,priority:data.priority,
    startsAt:event.startsAt,endsAt:event.endsAt
   }});
   for(let t=event.startsAt.getTime();t<event.endsAt.getTime();t+=data.slotMinutes*60000){
    const shift=await tx.shift.create({data:{
     eventId:id,workstationId:w.id,startsAt:new Date(t),
     endsAt:new Date(Math.min(t+data.slotMinutes*60000,event.endsAt.getTime())),
     minPeople:data.minPeople,idealPeople:data.idealPeople
    }});
    if(data.skillIds.length)await tx.shiftRequirement.createMany({
     data:data.skillIds.map(skillId=>({shiftId:shift.id,skillId}))
    });
   }
   // Keep published versions untouched and reject stale draft edits.
   await tx.scheduleVersion.updateMany({where:{eventId:id,status:'DRAFT'},data:{revision:{increment:1}}});
   await tx.auditLog.create({data:{
    actorId:actor.id,action:'CREATE',entity:'Workstation',entityId:w.id,
    details:{existingEventStatus:event.status,requiresReview:['GENERATED','PUBLISHED'].includes(event.status)}
   }});
   return {id:w.id,shiftsCreated:slotCount,requiresReview:['GENERATED','PUBLISHED'].includes(event.status)};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:20000});
  return ok(result,201);
 }catch(e){return fail(e);}
}
