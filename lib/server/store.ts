import 'server-only';
import { mkdir,readFile,rename,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { initialQuestions } from '../registry';
import { sharedResumeQuestions, sharedQuestionIds } from '../shared-questions';
import { sampleRoles } from '../fixtures';
import type { CandidateResults, Workspace } from '../schema';
import { hash } from './hash';
import { providerQuestion } from '../logic';
type StoreGlobal=typeof globalThis&{candidateWriteQueue?:Promise<unknown>};
const shared=globalThis as StoreGlobal;
export function dataDir() {return path.resolve(/*turbopackIgnore: true*/ process.env.CANDIDATE_DATA_DIR||'data');}
export function serialized<T>(fn:()=>Promise<T>):Promise<T> {
  const next=(shared.candidateWriteQueue??Promise.resolve()).then(fn,fn);
  shared.candidateWriteQueue=next.then(()=>undefined,()=>undefined); return next;
}
async function atomic(file:string,value:unknown) {
  await mkdir(path.dirname(file),{recursive:true});
  const temporary=`${file}.${randomUUID()}.tmp`;
  await writeFile(temporary,JSON.stringify(value),'utf8');
  for(let attempt=0;;attempt++) {
    try {await rename(temporary,file);break;}
    catch(e) {if(attempt>=5||!['EPERM','EACCES','EBUSY'].includes((e as NodeJS.ErrnoException).code??'')) throw e;await new Promise(resolve=>setTimeout(resolve,25*2**attempt));}
  }
}
export function emptyWorkspace():Workspace {return {schemaVersion:1,questionSelectionVersion:1,version:1,candidates:[],questions:structuredClone([...sharedResumeQuestions,...initialQuestions]),roles:structuredClone(sampleRoles).map(role=>({...role,questionIds:[...new Set([...sharedQuestionIds,...role.questionIds])]})),activeRoleId:'implementation',resolvedModel:null,verifiedRequestedModel:null,run:null};}
export async function readWorkspace():Promise<Workspace> {
  try {const w:Workspace=JSON.parse(await readFile(path.join(dataDir(),'workspace.json'),'utf8'));if(w.schemaVersion!==1) throw new Error('Unsupported workspace schema.');
    // Restore missing library definitions without overwriting recruiter edits or results.
    for(const q of [...sharedResumeQuestions,...initialQuestions]) if(!w.questions.some(existing=>existing.id===q.id)) w.questions.push(structuredClone(q));
    // Older releases always evaluated these seven implicitly. Record them as explicit
    // selections once, retaining every prior selection; later deselections stay off.
    if(w.questionSelectionVersion!==1) {
      for(const role of w.roles) role.questionIds=[...new Set([...sharedQuestionIds,...role.questionIds])];
      w.questionSelectionVersion=1;
    }
    return w;}
  catch(e) {if((e as NodeJS.ErrnoException).code==='ENOENT') return emptyWorkspace();throw e;}
}
export function updateWorkspace<T>(fn:(w:Workspace)=>T|Promise<T>):Promise<T> {
  return serialized(async()=>{const w=await readWorkspace();const result=await fn(w);w.version++;await atomic(path.join(dataDir(),'workspace.json'),w);return result;});
}
function resultPath(id:string) {return path.join(dataDir(),'results',hash(id)+'.json');}
export async function readResults(id:string):Promise<CandidateResults> {
  try {
    const results:CandidateResults=JSON.parse(await readFile(resultPath(id),'utf8'));
    if(results.cacheSchemaVersion===2) return results;
    // Preserve early prototype results while adding question identity to cache keys.
    const migrated:CandidateResults={cacheSchemaVersion:2,answers:{},evidence:{}};
    for(const [oldKey,answer] of Object.entries(results.answers)) {
      const q=answer.question;
      const key=hash({state:answer.stateHash,questionId:q.id,question:providerQuestion(q),version:q.version,model:answer.model,roleRevision:answer.roleRevision});
      migrated.answers[key]={...answer,key};
      if(results.evidence[oldKey]) migrated.evidence[key]={...results.evidence[oldKey],answerKey:key};
    }
    return migrated;
  }
  catch(e) {if((e as NodeJS.ErrnoException).code==='ENOENT') return {cacheSchemaVersion:2,answers:{},evidence:{}};throw e;}
}
export function updateResults<T>(id:string,fn:(r:CandidateResults)=>T|Promise<T>) {
  return serialized(async()=>{const r=await readResults(id);const result=await fn(r);await atomic(resultPath(id),r);return result;});
}
