import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initialQuestions,relevanceQuestion } from '../lib/registry';
import { sampleCandidates,sampleRoles } from '../lib/fixtures';
import { roleSchema, type JevResponse, type Question } from '../lib/schema';
import { readResults,readWorkspace,updateWorkspace,updateResults } from '../lib/server/store';
import { loadSamples,toCandidate,saveRole,saveQuestion,applyPlan } from '../lib/server/workspace';
import { batch,buildView,controlRun,keyFor,listCandidates,nextCandidate,requiredQuestions,startRun } from '../lib/server/evaluation';
import { scanWorkers } from '../lib/scan-workers';
import type { Decide } from '../lib/server/jev';
import { checkPassageIds,findEvidence } from '../lib/server/evidence';
let dir:string;
beforeEach(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'candidate-explorer-test-'));vi.stubEnv('CANDIDATE_DATA_DIR',dir);vi.stubEnv('TYPESAFE_MODEL','jev-latest');vi.stubEnv('JEV_CONCURRENCY','5');});
afterEach(async()=>{vi.unstubAllEnvs();if(!dir)return;const resolved=path.resolve(dir);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('candidate-explorer-test-'))throw new Error('Unsafe temporary cleanup target');await rm(resolved,{recursive:true,force:true});});
const mock:Decide=async request=>{
  const answers:JevResponse['answers']={};
  for(const [id,q] of Object.entries(request.questions)) {
    if(q.type==='noul') answers[id]={type:'noul',noul:0.8};
    if(q.type==='choice') {const keys=Object.keys(q.criteria);const selected=keys.includes('enough_detail')?'enough_detail':keys[0];answers[id]={type:'choice',choice:selected,confidence:0.9,probabilities:Object.fromEntries(keys.map(k=>[k,k===selected?1:0]))};}
    if(q.type==='score') answers[id]={type:'score',score:2,confidence:0.02,legend:Object.fromEntries(q.criteria.map((v,i)=>[i,String(v)])),probabilities:Object.fromEntries(q.criteria.map((_,i)=>[i,i===2?1:0]))};
  }
  return {model:request.model!,answers,usage:{input_tokens:100,output_tokens:10}};
};
async function setup() {await loadSamples();await updateWorkspace(w=>{w.candidates=w.candidates.slice(0,2);w.roles[0].criteria.forEach(c=>c.approved=true);w.resolvedModel='jev-1.13.0';w.verifiedRequestedModel='jev-latest';});return (await readWorkspace()).roles[0];}
describe('resumable evaluations with mocked providers only',()=>{
  it('replenishes parallel workers past a stalled resume without duplicate claims',async()=>{
    vi.stubEnv('JEV_CONCURRENCY','2');
    const role=await setup();
    await updateWorkspace(w=>{
      w.roles[0].criteria=[];
      w.candidates=Array.from({length:6},(_,i)=>toCandidate({id:`parallel_${i}`,text:`FICTIONAL parallel resume ${i}`}));
    });
    const gate=Promise.withResolvers<void>();
    let inFlight=0,peak=0;
    const adapter=vi.fn<Decide>(async req=>{
      inFlight++;peak=Math.max(peak,inFlight);
      try {if((req.state as {resume:string}).resume.endsWith(' 0')) await gate.promise;return await mock(req);}
      finally {inFlight--;}
    });
    const run=await startRun(role.id);
    const working=scanWorkers(2,async()=>{const result=await nextCandidate(run.id,adapter);return result.worked&&result.run.status==='running';},()=>false);
    try {
      await vi.waitFor(async()=>{
        const current=(await readWorkspace()).run!;
        expect(current.items.parallel_0.status).toBe('running');
        expect(Object.values(current.items).filter(i=>i.status==='complete')).toHaveLength(5);
      });
      expect(peak).toBe(2);
      expect(adapter).toHaveBeenCalledTimes(6);
    }finally {gate.resolve();await working;}
    const completed=(await readWorkspace()).run!;
    expect(completed.status).toBe('complete');
    expect(new Set(adapter.mock.calls.map(([req])=>(req.state as {resume:string}).resume)).size).toBe(6);
    const calls=adapter.mock.calls.length;
    const resumed=await startRun(role.id);
    await scanWorkers(2,async()=>{const result=await nextCandidate(resumed.id,adapter);return result.worked&&result.run.status==='running';},()=>false);
    expect(adapter).toHaveBeenCalledTimes(calls);
  });
  it('enforces the server cap across overlapping callers and pauses before new bundles',async()=>{
    vi.stubEnv('JEV_CONCURRENCY','2');
    const role=await setup();
    await updateWorkspace(w=>{w.candidates=sampleCandidates.slice(0,4).map(toCandidate);});
    const gate=Promise.withResolvers<void>();
    const adapter=vi.fn<Decide>(async req=>{await gate.promise;return mock(req);});
    const run=await startRun(role.id);
    const first=nextCandidate(run.id,adapter),second=nextCandidate(run.id,adapter);
    try {
      await vi.waitFor(()=>expect(adapter).toHaveBeenCalledTimes(2));
      expect((await nextCandidate(run.id,adapter)).worked).toBe(false);
      await controlRun(run.id,'pause');
      expect((await nextCandidate(run.id,adapter)).worked).toBe(false);
    }finally {gate.resolve();await Promise.all([first,second]);}
    const paused=(await readWorkspace()).run!;
    expect(paused.status).toBe('paused');
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(Object.values(paused.items).every(item=>item.status==='pending')).toBe(true);
    expect(Object.values((await readResults('c001')).answers).every(answer=>answer.question.scope==='general')).toBe(true);
    const resumed=await controlRun(run.id,'resume');
    await scanWorkers(2,async()=>{const result=await nextCandidate(resumed.id,adapter);return result.worked&&result.run.status==='running';},()=>false);
    expect((await readWorkspace()).run?.status).toBe('complete');
    expect(adapter).toHaveBeenCalledTimes(8);
  });
  it('counts overlapping worker elapsed time once',async()=>{
    const role=await setup();
    await updateWorkspace(w=>{w.roles[0].criteria=[];});
    const gate=Promise.withResolvers<void>();
    const clock=vi.spyOn(Date,'now').mockReturnValue(1000);
    const adapter=vi.fn<Decide>(async req=>{await gate.promise;return mock(req);});
    const run=await startRun(role.id);
    const working=batch(run.id,adapter);
    try {
      await vi.waitFor(()=>expect(adapter).toHaveBeenCalledTimes(2));
      clock.mockReturnValue(3000);gate.resolve();
      expect((await working).elapsedMs).toBe(2000);
    }finally {gate.resolve();await working;clock.mockRestore();}
  });
  it('bundles questions by shared state, saves before acknowledgement and reuses the cache',async()=>{const role=await setup();const adapter=vi.fn(mock);const run=await startRun(role.id);const completed=await batch(run.id,adapter);expect(completed.status).toBe('complete');expect(adapter).toHaveBeenCalledTimes(4);const general=adapter.mock.calls.find(([r])=>Object.keys(r.questions).includes('assessability'))![0];expect(Object.keys(general.questions)).toEqual(run.questions.filter(q=>q.scope==='general').map(q=>q.id));expect(general.questions).toHaveProperty('personal_task');expect(general.state).not.toHaveProperty('approved_active_role_brief');const persisted=await readResults('c001');expect(Object.keys(persisted.answers)).toHaveLength(run.questions.length);const again=await startRun(role.id);await batch(again.id,adapter);expect(adapter).toHaveBeenCalledTimes(4);expect((await readWorkspace()).run?.items.c001.cacheHits).toBe(run.questions.length);});
  it('revising role only evaluates affected role bundles; old results are stale on refresh',async()=>{const role=await setup();const adapter=vi.fn(mock);const run=await startRun(role.id);await batch(run.id,adapter);const changed=structuredClone(role);changed.criteria[0].enabled=false;await saveRole(changed,role);let w=await readWorkspace();const updated=w.roles[0];expect(updated.revision).toBe(2);const before=buildView(w.candidates[0],await readResults('c001'),updated,requiredQuestions(w,updated),w.resolvedModel,w.run);expect(before.score).toBeNull();expect(before.status).toBe('stale');expect(before.answers.technical_depth).toBeDefined();const next=await startRun(role.id);await batch(next.id,adapter);expect(adapter).toHaveBeenCalledTimes(6);w=await readWorkspace();expect(buildView(w.candidates[0],await readResults('c001'),w.roles[0],requiredQuestions(w,w.roles[0]),w.resolvedModel,w.run).score).toBe(2);});
  it('new selected semantic question evaluates just that question',async()=>{const role=await setup();const adapter=vi.fn(mock);await batch((await startRun(role.id)).id,adapter);const question:Question={...initialQuestions[0],id:'finance_python',instructions:'Does the resume describe using Python in the same finance project?',scope:'general'};await saveQuestion(question);await saveRole({...role,questionIds:[...role.questionIds,question.id]},role);const calls=adapter.mock.calls.length;await batch((await startRun(role.id)).id,adapter);expect(adapter.mock.calls.slice(calls).every(([r])=>Object.keys(r.questions).join()==='finance_python')).toBe(true);expect(adapter.mock.calls.length-calls).toBe(2);});
  it('failure is not a zero score and retry keeps completed bundles',async()=>{const role=await setup();let fail=true;const adapter=vi.fn<Decide>(async req=>{if('role_relevance' in req.questions&&fail) throw new Error('Simulated failure');return mock(req);});const run=await startRun(role.id);await batch(run.id,adapter);const w=await readWorkspace();expect(w.run?.items.c001.status).toBe('failed');const view=buildView(w.candidates[0],await readResults('c001'),role,requiredQuestions(w,role),w.resolvedModel,w.run);expect(view.score).toBeNull();expect(Object.keys(view.answers)).toHaveLength(run.questions.filter(q=>q.scope==='general').length);fail=false;await controlRun(run.id,'retry');await batch(run.id,adapter);expect(adapter).toHaveBeenCalledTimes(6);});
  it('insufficient detail remains accessible without assigning a negative or fabricated score',async()=>{const role=await setup();const adapter:Decide=async req=>{const r=await mock(req);if(r.answers.assessability?.type==='choice'){r.answers.assessability.choice='insufficient_detail';r.answers.assessability.probabilities={enough_detail:0,insufficient_detail:1,damaged_text:0};}return r;};await batch((await startRun(role.id)).id,adapter);const w=await readWorkspace();const v=buildView(w.candidates[0],await readResults('c001'),role,requiredQuestions(w,role),w.resolvedModel,w.run);expect(v.status).toBe('insufficient');expect(v.score).toBeNull();expect(v.answers.role_relevance.answer).toHaveProperty('score',2);expect((await listCandidates(role.id,1,'all')).total).toBe(2);});
  it('resumes running items after a simulated server restart without mixing revisions',async()=>{const role=await setup();const run=await startRun(role.id);await updateWorkspace(w=>{w.run!.items.c001.status='running';});const adapter=vi.fn(mock);await batch(run.id,adapter);expect((await readWorkspace()).run?.items.c001.status).toBe('complete');await controlRun(run.id,'pause');await saveRole({...role,rubric:['none','some','substantial']},role);await expect(controlRun(run.id,'resume')).rejects.toThrow('earlier');});
  it('pause stops scheduling, and question changes require a new run',async()=>{const role=await setup();const run=await startRun(role.id);await controlRun(run.id,'pause');const adapter=vi.fn(mock);await batch(run.id,adapter);expect(adapter).not.toHaveBeenCalled();const w=await readWorkspace();await saveQuestion({...w.questions.find(q=>q.id==='technical_depth')!,instructions:'Rate the engineering complexity demonstrated in the resume.'});await expect(controlRun(run.id,'resume')).rejects.toThrow('questions changed');});
  it('rejects mixed model responses without saving their answers',async()=>{const role=await setup();const adapter:Decide=async req=>({...await mock(req),model:'jev-other'});const run=await startRun(role.id);await batch(run.id,adapter);expect(Object.keys((await readResults('c001')).answers)).toHaveLength(0);expect((await readWorkspace()).run?.items.c001.status).toBe('failed');});
});
describe('pool scope and storage',()=>{
  it('broadening filters searches all 1,000 records before pagination without provider calls',async()=>{const role=await setup();await updateWorkspace(w=>{w.candidates=Array.from({length:1000},(_,i)=>toCandidate({id:`pool_${String(i).padStart(4,'0')}`,name:'Synthetic load test',text:`FICTIONAL LOAD TEST ${i}`}));});let w=await readWorkspace();const candidate=w.candidates[999],q=initialQuestions.find(q=>q.id==='applied_skills')!;const key=keyFor(candidate,q,role,w.resolvedModel!);await updateResults(candidate.id,r=>{r.answers[key]={key,question:q,answer:{type:'noul',noul:0.7},model:w.resolvedModel!,stateHash:'test',createdAt:new Date().toISOString(),roleRevision:null,roleId:null};});const plan={summary:'filter',clarification:null,filter:{join:'and' as const,includeUnknown:false,groups:[{join:'and' as const,conditions:[{questionId:q.id,operator:'gte' as const,value:0.8}]}]},additions:[],changes:[]};await applyPlan(role.id,role,plan,'filter stored answers');expect((await listCandidates(role.id,1,'all')).total).toBe(0);w=await readWorkspace();plan.filter.groups[0].conditions[0].value=0.6;await applyPlan(role.id,w.roles[0],plan,'broaden cutoff');const list=await listCandidates(role.id,1,'all');expect(list.total).toBe(1);expect(list.rows[0].id).toBe('pool_0999');expect((await readWorkspace()).roles[0].revision).toBe(role.revision);});
  it('accepts equivalent parsed role objects with a different property order',async()=>{const role=await setup();const parsed=roleSchema.parse(role);await expect(saveRole({...parsed,name:'Updated role'},parsed)).resolves.toHaveProperty('name','Updated role');});
  it('serializes concurrent metadata updates without lost writes',async()=>{await Promise.all(Array.from({length:15},(_,i)=>updateWorkspace(w=>{w.candidates.push(toCandidate({id:`x${i}`,text:'resume'}));})));expect((await readWorkspace()).candidates).toHaveLength(15);});
});
describe('supporting passages',()=>{
  it('rejects nonexistent IDs and returns original text only',async()=>{const candidate=toCandidate(sampleCandidates[0]);expect(()=>checkPassageIds(candidate,['invented'])).toThrow('nonexistent');const role=await setup();await batch((await startRun(role.id)).id,mock);const a=Object.values((await readResults('c001')).answers).find(a=>a.question.id==='mentorship_demonstrated')!;const adapter:Decide=async req=>({model:req.model!,answers:{where:{type:'choice',choice:'no_support',confidence:0.8,probabilities:{p0001:0.1,p0002:0.1,p0003:0.1,no_support:0.7}},exists:{type:'noul',noul:0.2}}});const evidence=await findEvidence(candidate,a,role,adapter);expect(evidence.selectedId).toBeNull();expect(evidence.exists).toBe(0.2);expect((await readResults('c001')).evidence[a.key]).toEqual(evidence);});
});
