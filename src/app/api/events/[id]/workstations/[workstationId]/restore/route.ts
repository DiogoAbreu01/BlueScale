import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { STAFF, fail, HttpError, ok, requireRole, sameOrigin } from '@/lib/api';

type Context={params:Promise<{id:string;workstationId:string}>};

export async function POST(req:NextRequest,{params}:Context){
 try{
  const actor=await requireRole(STAFF);
  sameOrigin(req);
  const {id,workstationId}=await params;
  const result=await prisma.$transaction(async tx=>{
   const post=await tx.workstation.findFirst({
    where:{id:workstationId,eventId:id,archivedAt:{not:null}},
    select:{id:true,event:{select:{status:true}}}
   });
   if(!post)throw new HttpError(404,'Posto removido não encontrado.');
   if(['COMPLETED','CANCELLED'].includes(post.event.status))throw new HttpError(409,'Evento encerrado; não é possível restaurar postos.');
   await tx.workstation.update({where:{id:workstationId},data:{archivedAt:null}});
   await tx.scheduleVersion.updateMany({
    where:{eventId:id,status:'DRAFT'},data:{revision:{increment:1}}
   });
   await tx.auditLog.create({data:{
    actorId:actor.id,action:'RESTORE',entity:'Workstation',entityId:workstationId,
    details:{preservedHistory:true}
   }});
   return {id:workstationId,restored:true,preservedHistory:true};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
  return ok(result);
 }catch(e){return fail(e)}
}
