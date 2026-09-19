import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Candidate, CandidateResults, CandidateView, JevResponse, Question, Role, Run, StoredAnswer, Workspace } from '../schema';
import { initialQuestions, relevanceQuestion } from '../registry';
import { assessmentDate } from '../shared-questions';
import { activeBrief, compareViews, evaluationState, matchesFilter, providerQuestion } from '../logic';
import { hash } from './hash';
import { readResults, readWorkspace, updateResults, updateWorkspace } from './store';
import { concurrency, decide, requestedModel, type Decide } from './jev';
import { PublicError, safeError } from './errors';

export function requiredQuestions(w:Pick<Workspace,'questions'>,role:Role) {
  const ids=new Set([...role.questionIds,'assessability']);
  const qs=w.questions.filter(q=>ids.has(q.id)&&q.id!=='role_relevance');
  if(!qs.some(q=>q.id==='assessability')) qs.push(initialQuestions.find(q=>q.id==='assessability')!);
  if(activeBrief(role)) qs.push(relevanceQuestion(role.rubric));
  return qs;
}
export function keyFor(candidate:Candidate,q:Question,role:Role,model:string,today=assessmentDate()) {
  const state=evaluationState(candidate.text,q.scope==='role'?role:undefined);
  return hash({state:hash(state),questionId:q.id,question:providerQuestion(q,today),version:q.version,model,roleRevision:q.scope==='role'?role.revision:null});
}
function matchingRun(role:Role,questions:Question[],model:string|null,run:Run|null) {
  if(!run||run.role.id!==role.id||run.role.revision!==role.revision||run.model!==model) return null;
  // Filters may reveal cached attributes outside the scan selection. Only selected
  // definitions determine whether a previous scan's failure still applies.
  const selectedIds=new Set([...role.questionIds,'assessability','role_relevance']);
  return hash(run.questions)===hash(questions.filter(q=>selectedIds.has(q.id)))?run:null;
}
export function buildView(candidate:Candidate,results:CandidateResults,role:Role,questions:Question[],model:string|null,run:Run|null):CandidateView {
  const answers:Record<string,StoredAnswer>={};
  if(model) for(const q of questions) {const a=results.answers[keyFor(candidate,q,role,model)];if(a) answers[q.id]=a;}
  const currentKeys=new Set(Object.values(answers).map(a=>a.key));
  const oldAnswers=Object.values(results.answers).filter(a=>!currentKeys.has(a.key)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const assessability=answers.assessability?.answer;
  const insufficient=assessability?.type==='choice'&&assessability.choice!=='enough_detail';
  const relevance=answers.role_relevance?.answer;
  const item=matchingRun(role,questions,model,run)?.items[candidate.id];
  const score=!insufficient&&relevance?.type==='score'?relevance.score:null;
  const complete=questions.every(q=>!!answers[q.id]);
  const stale=oldAnswers.some(a=>questions.some(q=>q.id===a.question.id&&!answers[q.id]));
  const status=insufficient?'insufficient':item?.status==='failed'?'failed':complete?'current':stale?'stale':'pending';
  return {candidate,answers,oldAnswers,score,status,error:item?.error};
}
export async function allViews(w:Workspace,role:Role) {
  // Filter the whole pool first; pagination happens after filtering and sorting.
  const qs=requiredQuestions(w,role);
  // Filters may refer to hidden attributes; display selection never changes stored answers.
  const filterIds=role.filter?.groups.flatMap(g=>g.conditions.map(c=>c.questionId))??[];
  for(const id of filterIds) {const q=w.questions.find(q=>q.id===id);if(q&&!qs.some(x=>x.id===id)) qs.push(q);}
  const views:CandidateView[]=[];
  for(let offset=0;offset<w.candidates.length;offset+=50) views.push(...await Promise.all(w.candidates.slice(offset,offset+50).map(async c=>buildView(c,await readResults(c.id),role,qs,w.resolvedModel,w.run))));
  return views;
}
export async function candidateDetail(roleId:string,candidateId:string) {
  const w=await readWorkspace();
  const role=w.roles.find(r=>r.id===roleId);
  if(!role) throw new PublicError('Role not found.',404);
  const candidate=w.candidates.find(c=>c.id===candidateId);
  if(!candidate) throw new PublicError('Candidate not found.',404);
  const results=await readResults(candidate.id);
  return {...buildView(candidate,results,role,requiredQuestions(w,role),w.resolvedModel,w.run),evidence:results.evidence};
}
export async function listCandidates(roleId:string,page:number,mode:string,bookmarked=false) {
  const w=await readWorkspace();const role=w.roles.find(r=>r.id===roleId);if(!role) throw new PublicError('Role not found.',404);
  const views=await allViews(w,role);
  const counts={all:views.length,current:views.filter(v=>v.status==='current').length,pending:views.filter(v=>v.status==='pending').length,stale:views.filter(v=>v.status==='stale').length,failed:views.filter(v=>v.status==='failed').length,insufficient:views.filter(v=>v.status==='insufficient').length};
  const matching=views.filter(v=>(mode==='all'||v.status===mode)&&(bookmarked?v.candidate.bookmarked:true)&&matchesFilter(Object.fromEntries(Object.entries(v.answers).map(([id,a])=>[id,a.answer])),role.filter)).sort(compareViews);
  const pages=Math.max(1,Math.ceil(matching.length/25));const actualPage=Math.min(pages,Math.max(1,page));
  const scanQuestions=requiredQuestions(w,role);
  const applicableRun=matchingRun(role,scanQuestions,w.resolvedModel,w.run);
  const scanItems=views.map(v=>({id:v.candidate.id,status:(applicableRun?.items[v.candidate.id]?.status==='failed'?'failed':scanQuestions.every(q=>!!v.answers[q.id])?'complete':'pending') as 'complete'|'failed'|'pending'|'running'}));
  return {counts,scanItems,total:matching.length,pages,page:actualPage,rows:matching.slice((actualPage-1)*25,actualPage*25).map(v=>({id:v.candidate.id,name:v.candidate.name,bookmarked:v.candidate.bookmarked,fictional:v.candidate.fictional,excerpt:v.candidate.text.slice(0,180),score:v.score,status:v.status,error:v.error,answered:Object.keys(v.answers).length,relevance:v.answers.role_relevance?.answer??null}))};
}
export async function startRun(roleId:string,candidateIds?:string[]) {
  return updateWorkspace(w=>{
    if(w.run?.status==='running') throw new PublicError('Pause the current evaluation before starting another.',409);
    const role=w.roles.find(r=>r.id===roleId);if(!role) throw new PublicError('Role not found.',404);
    if(!w.resolvedModel||w.verifiedRequestedModel!==requestedModel()) throw new PublicError('Verify connections before evaluating. This checks model access and pins the returned JEV version.');
    const ids=candidateIds??w.candidates.map(c=>c.id);
    if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!w.candidates.some(c=>c.id===id))) throw new PublicError('Select a valid, non-empty candidate pool.');
    const run:Run={id:randomUUID(),role:structuredClone(role),questions:requiredQuestions(w,role),model:w.resolvedModel,candidateIds:ids,items:Object.fromEntries(ids.map(id=>[id,{status:'pending',cacheHits:0,inputTokens:0,outputTokens:0}])),status:'running',createdAt:new Date().toISOString(),asOfDate:assessmentDate(),elapsedMs:0};
    w.run=run;return run;
  });
}
export function validateAnswers(response:JevResponse,questions:Question[],model:string) {
  if(response.model!==model) throw new PublicError('JEV returned a different model version. Reverify connections and start a new evaluation; results were not mixed.',502);
  for(const q of questions) {
    const a=response.answers[q.id];
    if(!a||a.type!==q.primitive) throw new PublicError('JEV omitted an answer or returned the wrong primitive. No fabricated answer was saved.',502);
    if(a.type==='choice'&&!q.options.some(o=>o.id===a.choice)) throw new PublicError('JEV selected an undefined category.',502);
    if(a.type==='score'&&(a.score<0||a.score>q.levels.length-1)) throw new PublicError('JEV returned a score outside its rubric.',502);
    if(a.type!=='noul') {
      const keys=a.type==='choice'?q.options.map(o=>o.id):q.levels.map((_,i)=>String(i));
      if(keys.length!==Object.keys(a.probabilities).length||keys.some(k=>!(k in a.probabilities))||Math.abs(Object.values(a.probabilities).reduce((a,b)=>a+b,0)-1)>0.02) throw new PublicError('JEV returned an invalid probability distribution.',502);
    }
  }
}
export async function evaluateCandidate(candidate:Candidate,run:Run,adapter:Decide=decide,shouldContinue:()=>Promise<boolean>=async()=>true) {
  let cacheHits=0;
  const results=await readResults(candidate.id);
  const missing=run.questions.filter(q=>{const hit=!!results.answers[keyFor(candidate,q,run.role,run.model,run.asOfDate)];if(hit) cacheHits++;return !hit;});
  await updateWorkspace(w=>{const item=w.run?.id===run.id?w.run.items[candidate.id]:undefined;if(item) item.cacheHits=cacheHits;});
  for(const scope of ['general','role'] as const) {
    const questions=missing.filter(q=>q.scope===scope);if(!questions.length) continue;
    if(!await shouldContinue()) return false;
    const state=evaluationState(candidate.text,scope==='role'?run.role:undefined);
    const response=await adapter({model:run.model,state,questions:Object.fromEntries(questions.map(q=>[q.id,providerQuestion(q,run.asOfDate)]))});
    validateAnswers(response,questions,run.model);
    // A completed bundle is durable before it contributes to progress.
    await updateResults(candidate.id,r=>{for(const q of questions) {const key=keyFor(candidate,q,run.role,run.model,run.asOfDate);r.answers[key]={key,question:{...q,instructions:q.instructions.replaceAll('{{today}}',run.asOfDate??assessmentDate())},answer:response.answers[q.id],model:response.model,stateHash:hash(state),createdAt:new Date().toISOString(),roleRevision:scope==='role'?run.role.revision:null,roleId:scope==='role'?run.role.id:null};}});
    await updateWorkspace(w=>{const item=w.run?.id===run.id?w.run.items[candidate.id]:undefined;if(item) {item.inputTokens+=response.usage?.input_tokens??0;item.outputTokens+=response.usage?.output_tokens??0;}});
  }
  return true;
}
type ActiveScan={ids:Set<string>;accountedAt:number};
type Globals=typeof globalThis&{activeScans?:Map<string,ActiveScan>};
const shared=globalThis as Globals;
// Each browser worker owns one request. Claim under the same lock as persistence,
// so overlapping requests/tabs cannot evaluate a candidate twice. Running records
// without an in-memory owner are recoverable after a server restart.
export async function nextCandidate(runId:string,adapter:Decide=decide) {
  shared.activeScans??=new Map();
  let active:ActiveScan|undefined;
  let candidateId:string|undefined;
  try {
    const {run,candidate}=await updateWorkspace(w=>{
      const run=w.run;
      if(!run||run.id!==runId) throw new PublicError('Evaluation not found.',404);
      if(run.status!=='running') return {run,candidate:undefined};
      active=shared.activeScans!.get(runId);
      if(active&&active.ids.size>=concurrency()) return {run,candidate:undefined};
      candidateId=run.candidateIds.find(id=>['pending','running'].includes(run.items[id].status)&&!active?.ids.has(id));
      if(!candidateId) return {run,candidate:undefined};
      const candidate=w.candidates.find(c=>c.id===candidateId);
      if(!candidate) throw new PublicError('Candidate source no longer exists.');
      active??={ids:new Set(),accountedAt:Date.now()};
      active.ids.add(candidateId);
      shared.activeScans!.set(runId,active);
      run.items[candidateId].status='running';
      return {run,candidate};
    });
    if(!candidate) return {run,worked:false};
    let complete=false;
    let failed=false;
    let failure:unknown;
    try {
      complete=await evaluateCandidate(candidate,run,adapter,async()=>{const latest=await readWorkspace();return latest.run?.id===runId&&latest.run.status==='running';});
    }catch(e) {failed=true;failure=e;}
    const updated=await updateWorkspace(w=>{
      if(w.run?.id!==runId) throw new PublicError('Evaluation changed.',409);
      const item=w.run.items[candidate.id];
      item.status=failed?'failed':complete?'complete':'pending';
      delete item.error;delete item.retryAfterUntil;
      if(failed) {
        item.error=safeError(failure);
        if(failure instanceof PublicError&&failure.retryAfter) item.retryAfterUntil=Date.now()+failure.retryAfter*1000;
      }
      // Account for overlapping requests once, rather than summing worker time.
      const now=Date.now();w.run.elapsedMs+=now-active!.accountedAt;active!.accountedAt=now;
      if(Object.values(w.run.items).every(i=>i.status==='complete'||i.status==='failed')) w.run.status='complete';
      return w.run;
    });
    return {run:updated,worked:true};
  }finally {
    if(candidateId&&active) active.ids.delete(candidateId);
    if(active&&!active.ids.size) shared.activeScans.delete(runId);
  }
}
// Retain the bounded batch API for scripts; the UI replenishes individual workers.
export async function batch(runId:string,adapter:Decide=decide) {
  const outcomes=await Promise.allSettled(Array.from({length:concurrency()},()=>nextCandidate(runId,adapter)));
  const failure=outcomes.find(result=>result.status==='rejected');
  if(failure?.status==='rejected') throw failure.reason;
  const w=await readWorkspace();
  if(w.run?.id!==runId) throw new PublicError('Evaluation changed.',409);
  return w.run;
}
export async function controlRun(runId:string,action:'pause'|'resume'|'retry') {
  return updateWorkspace(w=>{
    if(!w.run||w.run.id!==runId) throw new PublicError('Evaluation not found.',404);
    if(action!=='pause') {
      if(w.run.asOfDate&&w.run.asOfDate!==assessmentDate()) throw new PublicError('The assessment date changed. Start a new evaluation to refresh date-dependent answers.');
      const role=w.roles.find(r=>r.id===w.run!.role.id);
      if(!role||role.revision!==w.run.role.revision||w.resolvedModel!==w.run.model) throw new PublicError('This evaluation belongs to an earlier role or model revision. Start a new evaluation.');
      if(hash(requiredQuestions(w,role))!==hash(w.run.questions)) throw new PublicError('The selected questions changed. Start a new evaluation to reuse valid cached answers and evaluate the new questions.');
    }
    if(action==='retry') {
      const wait=Math.max(0,...Object.values(w.run.items).filter(i=>i.status==='failed').map(i=>(i.retryAfterUntil??0)-Date.now()));
      if(wait>0) throw new PublicError('The provider cooldown has not elapsed. Try again after the displayed wait.',429,Math.ceil(wait/1000));
      for(const item of Object.values(w.run.items)) if(item.status==='failed') {item.status='pending';delete item.error;delete item.retryAfterUntil;}
    }
    w.run.status=action==='pause'?'paused':'running';return w.run;
  });
}
export function runSummary(run:Run|null) {
  if(!run) return null;const items=Object.values(run.items);
  return {id:run.id,roleId:run.role.id,revision:run.role.revision,model:run.model,status:run.status,total:items.length,processed:items.filter(i=>i.status==='complete'||i.status==='failed').length,failed:items.filter(i=>i.status==='failed').length,pending:items.filter(i=>i.status==='pending'||i.status==='running').length,cacheHits:items.reduce((s,i)=>s+i.cacheHits,0),inputTokens:items.reduce((s,i)=>s+i.inputTokens,0),outputTokens:items.reduce((s,i)=>s+i.outputTokens,0),elapsedMs:run.elapsedMs};
}
