import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { safeId, roleSchema, questionSchema, proposalSchema, planSchema } from '@/lib/schema';
import { readWorkspace, updateWorkspace } from '@/lib/server/store';
import { publicWorkspace, importCandidates, loadSamples, saveRole, saveQuestion, approveProposals, applyPlan, verifyConnections } from '@/lib/server/workspace';
import { allViews, batch, candidateDetail, controlRun, listCandidates, nextCandidate, runSummary, startRun } from '@/lib/server/evaluation';
import { generateQuestions, interpretSearch, quotationWarnings } from '@/lib/server/openrouter';
import { findEvidence } from '@/lib/server/evidence';
import { PublicError, safeError } from '@/lib/server/errors';
import { relevanceQuestion } from '@/lib/registry';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function localOnly(req:NextRequest) {
  const requestHost=req.headers.get('host');
  const host=requestHost?new URL(`http://${requestHost}`).hostname:'';
  if(!['127.0.0.1','localhost','[::1]'].includes(host)) throw new PublicError('Local access only.',403);
  const origin=req.headers.get('origin');
  if(origin&&(new URL(origin).host!==requestHost||new URL(origin).protocol!==req.nextUrl.protocol)) throw new PublicError('Cross-origin access is not allowed.',403);
  if(req.headers.get('sec-fetch-site')==='cross-site') throw new PublicError('Cross-site access is not allowed.',403);
}
async function readBody(req:NextRequest) {
  const max=24*1024*1024;const reader=req.body?.getReader();if(!reader) throw new PublicError('Request body is missing.');
  let size=0;const chunks:Uint8Array[]=[];
  while(true) {const {value,done}=await reader.read();if(done) break;size+=value.byteLength;if(size>max) {await reader.cancel();throw new PublicError('Request is too large.',413);}chunks.push(value);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new PublicError('Request must contain valid JSON.');}
}
async function respond(fn:()=>Promise<unknown>) {
  try {return NextResponse.json(await fn(),{headers:{'Cache-Control':'no-store'}});}
  catch(e) {const message=e instanceof z.ZodError?'The supplied fields failed validation. Review the question, rubric, or plan.':safeError(e);return NextResponse.json({error:message,retryAfter:e instanceof PublicError?e.retryAfter:undefined},{status:e instanceof PublicError?e.status:e instanceof z.ZodError?400:500,headers:{'Cache-Control':'no-store',...(e instanceof PublicError&&e.retryAfter?{'Retry-After':String(e.retryAfter)}:{})}});}
}
export async function GET(req:NextRequest,{params}:{params:Promise<{action:string}>}) {
  return respond(async()=>{localOnly(req);const {action}=await params;
    if(action==='workspace') return publicWorkspace();
    if(action==='progress') {const w=await readWorkspace();return w.run?{...runSummary(w.run),items:Object.entries(w.run.items).map(([id,item])=>({id,status:item.status}))}:null;}
    if(action==='candidates') return listCandidates(safeId.parse(req.nextUrl.searchParams.get('roleId')),Number(req.nextUrl.searchParams.get('page')||1),req.nextUrl.searchParams.get('mode')||'all',req.nextUrl.searchParams.get('bookmarked')==='true');
    if(action==='candidate') return candidateDetail(safeId.parse(req.nextUrl.searchParams.get('roleId')),safeId.parse(req.nextUrl.searchParams.get('id')));
    throw new PublicError('Not found.',404);
  });
}
export async function POST(req:NextRequest,{params}:{params:Promise<{action:string}>}) {
  return respond(async()=>{localOnly(req);const {action}=await params;const body=await readBody(req);
    if(action==='samples') return loadSamples();
    if(action==='import') {const b=z.object({content:z.string(),format:z.enum(['json','csv','text']),mapping:z.object({id:z.string(),name:z.string().optional(),text:z.string()}).optional()}).strict().parse(body);return importCandidates(b.content,b.format,b.mapping);}
    if(action==='role') {const b=z.object({role:roleSchema,base:roleSchema.nullable()}).strict().parse(body);return saveRole(b.role,b.base);}
    if(action==='question') return saveQuestion(questionSchema.parse(body));
    if(action==='bookmark') {const b=z.object({id:safeId,bookmarked:z.boolean()}).strict().parse(body);return updateWorkspace(w=>{const c=w.candidates.find(c=>c.id===b.id);if(!c) throw new PublicError('Candidate not found.',404);c.bookmarked=b.bookmarked;return {ok:true};});}
    if(action==='verify') return verifyConnections();
    if(action==='generate') {const b=z.object({roleId:safeId,replaceId:safeId.optional(),replaceProposal:proposalSchema.optional()}).strict().parse(body);const w=await readWorkspace();const r=w.roles.find(r=>r.id===b.roleId);if(!r) throw new PublicError('Role not found.',404);if(!r.jd.trim()) throw new PublicError('Paste a job description first.');const result=await generateQuestions(r,w.questions,b.replaceId,b.replaceProposal);return {...result,warnings:quotationWarnings(result.value.proposals,r),base:r};}
    if(action==='approve') {const b=z.object({roleId:safeId,base:roleSchema,items:z.array(z.object({proposal:proposalSchema,useRelevance:z.boolean()}).strict()).min(1)}).strict().parse(body);return approveProposals(b.roleId,b.base,b.items);}
    if(action==='interpret') {const b=z.object({roleId:safeId,request:z.string().trim().min(1).max(12000)}).strict().parse(body);const w=await readWorkspace();const r=w.roles.find(r=>r.id===b.roleId);if(!r) throw new PublicError('Role not found.',404);const result=await interpretSearch(b.request,r,[...w.questions,relevanceQuestion(r.rubric)]);return {...result,base:r,request:b.request};}
    if(action==='apply') {const b=z.object({roleId:safeId,base:roleSchema,plan:planSchema,request:z.string().trim().min(1).max(12000)}).strict().parse(body);return applyPlan(b.roleId,b.base,b.plan,b.request);}
    if(action==='evaluate') {const b=z.object({action:z.enum(['start','batch','next','pause','resume','retry']),roleId:safeId.optional(),runId:z.string().uuid().optional(),candidateIds:z.array(safeId).optional()}).strict().parse(body);
      if(b.action==='start') {if(!b.roleId) throw new PublicError('Select a role.');return runSummary(await startRun(b.roleId,b.candidateIds));}
      if(!b.runId) throw new PublicError('Select an evaluation.');
      if(b.action==='next') {const result=await nextCandidate(b.runId);return {...runSummary(result.run),worked:result.worked};}
      return runSummary(b.action==='batch'?await batch(b.runId):await controlRun(b.runId,b.action));}
    if(action==='evidence') {const b=z.object({roleId:safeId,candidateId:safeId,questionId:safeId}).strict().parse(body);const w=await readWorkspace();const r=w.roles.find(r=>r.id===b.roleId);if(!r) throw new PublicError('Role not found.',404);const v=(await allViews(w,r)).find(v=>v.candidate.id===b.candidateId);if(!v||!v.answers[b.questionId]) throw new PublicError('Evaluate the current question before retrieving evidence.');return findEvidence(v.candidate,v.answers[b.questionId],r);}
    throw new PublicError('Not found.',404);
  });
}
