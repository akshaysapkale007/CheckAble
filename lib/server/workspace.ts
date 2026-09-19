import 'server-only';
import { randomUUID } from 'node:crypto';
import { questionSchema, roleSchema, type Candidate, type Proposal, type Question, type Role, type SearchPlan, type Workspace } from '../schema';
import { activeBrief, nextRevision, providerQuestion, sourceMatches, validateFilter, validatePlan } from '../logic';
import { parseImport, paragraphs, type ImportRow } from '../imports';
import { sampleCandidates } from '../fixtures';
import { relevanceQuestion } from '../registry';
import { sharedQuestionIds } from '../shared-questions';
import { hash } from './hash';
import { configuration, requestedModel, verifyJev } from './jev';
import { verifyOpenRouter } from './openrouter';
import { readWorkspace, updateWorkspace } from './store';
import { runSummary } from './evaluation';
import { PublicError } from './errors';
export function noActiveRun(w:Workspace) {if(w.run?.status==='running') throw new PublicError('Pause evaluation before changing its source or role configuration.',409);}
export function toCandidate(row:ImportRow):Candidate {return {id:row.id,name:row.name?.trim()||row.id,text:row.text,paragraphs:paragraphs(row.text),hash:hash(row.text),bookmarked:false,fictional:row.fictional??row.text.startsWith('FICTIONAL')};}
export async function publicWorkspace() {
  const w=await readWorkspace();return {version:w.version,roles:w.roles,questions:w.questions,activeRoleId:w.activeRoleId,candidateCount:w.candidates.length,configuration:configuration(),resolvedModel:w.resolvedModel,verifiedRequestedModel:w.verifiedRequestedModel,run:runSummary(w.run)};
}
export async function importCandidates(content:string,format:'json'|'csv'|'text',mapping?:{id:string;name?:string;text:string}) {
  return updateWorkspace(w=>{noActiveRun(w);let rows;try {rows=parseImport(content,format,mapping,w.candidates.map(c=>c.id));}catch(e) {throw new PublicError((e as Error).message);}w.candidates.push(...rows.map(toCandidate));return {imported:rows.length};});
}
export async function loadSamples() {return updateWorkspace(w=>{noActiveRun(w);const rows=sampleCandidates.filter(c=>!w.candidates.some(x=>x.id===c.id));w.candidates.push(...rows.map(toCandidate));return {imported:rows.length};});}
function validateRole(role:Role,questions:Question[]) {
  if(new Set(role.criteria.map(c=>c.id)).size!==role.criteria.length) throw new PublicError('Duplicate criterion IDs.');
  if(new Set(role.questionIds).size!==role.questionIds.length||role.questionIds.some(id=>!questions.some(q=>q.id===id))) throw new PublicError('Role uses an unknown or duplicate question.');
  for(const c of role.criteria) {
    if(c.questionId&&!questions.some(q=>q.id===c.questionId)) throw new PublicError('Criterion refers to an unknown question.');
    const q=questions.find(q=>q.id===c.questionId);
    if(q?.group==='Writing diagnostics') throw new PublicError('Writing diagnostics cannot be used for role relevance.');
    if(c.approved&&!sourceMatches(c.source,role.jd,role.recruiterInstructions)) throw new PublicError('An approved criterion has an unmatched source quotation. Edit its source or unapprove it.');
  }
  try {validateFilter(role.filter,[...questions,relevanceQuestion(role.rubric)]);}catch(e) {throw new PublicError((e as Error).message);}
}
export async function saveRole(input:Role,base:Role|null) {
  const role=roleSchema.parse(input);
  return updateWorkspace(w=>{noActiveRun(w);const i=w.roles.findIndex(r=>r.id===role.id);
    if(i>=0) {if(!base||hash(w.roles[i])!==hash(base)) throw new PublicError('This role changed in another view. Reload before saving.',409);role.revision=nextRevision(w.roles[i],role);}
    else role.revision=1;
    validateRole(role,w.questions);
    if(i>=0) w.roles[i]=role;else w.roles.push(role);w.activeRoleId=role.id;return role;
  });
}
export async function saveQuestion(input:Question) {
  const question=questionSchema.parse(input);
  if(sharedQuestionIds.has(question.id)&&question.scope!=='general') throw new PublicError('Shared resume questions must stay general so answers can be reused across roles.');
  if(question.id==='role_relevance') throw new PublicError('Edit role relevance using the role rubric editor.');
  return updateWorkspace(w=>{noActiveRun(w);const existing=w.questions.find(q=>q.id===question.id);question.version=(existing?.version??0)+1;
    if(existing) w.questions[w.questions.indexOf(existing)]=question;else w.questions.push(question);return question;
  });
}
function addProposal(w:Workspace,role:Role,p:Proposal,useRelevance:boolean,request:string) {
  if(!sourceMatches(p.source,role.jd,request)) throw new PublicError('The proposed source quotation does not match the supplied text. Edit it before approval.');
  const same=w.questions.find(q=>q.scope===p.question.scope&&JSON.stringify(providerQuestion(q))===JSON.stringify(providerQuestion(p.question)));
  let id=p.reuseQuestionId??same?.id??null;
  if(id&&!w.questions.some(q=>q.id===id)) throw new PublicError('The proposal reuses an unknown question.');
  if(p.reuseQuestionId) {
    const original=w.questions.find(q=>q.id===p.reuseQuestionId)!;
    if(original.scope!==p.question.scope||hash(providerQuestion(original))!==hash(providerQuestion(p.question))) throw new PublicError('The reused question differs from the definition shown for approval. Edit it as a new question or regenerate.');
  }
  if(!id) {
    id=p.question.id;
    if(id==='role_relevance'||w.questions.some(q=>q.id===id)) id=`q_${randomUUID().replaceAll('-','').slice(0,12)}`;
    const q=questionSchema.parse({...p.question,id,version:1});w.questions.push(q);
  }
  if(!role.questionIds.includes(id)) role.questionIds.push(id);
  if(useRelevance) {
    const existing=role.criteria.find(c=>c.text===p.criterion&&c.status===p.status);
    if(existing) {existing.approved=true;existing.enabled=true;existing.questionId??=id;for(const text of p.alternatives) if(!existing.alternatives.some(a=>a.text===text)) existing.alternatives.push({text,approved:false});}
    else role.criteria.push({id:`criterion_${randomUUID().replaceAll('-','').slice(0,12)}`,questionId:id,text:p.criterion,status:p.status,source:p.source,approved:true,enabled:true,alternatives:p.alternatives.map(text=>({text,approved:false}))});
  }
  return id;
}
export async function approveProposals(roleId:string,base:Role,items:{proposal:Proposal;useRelevance:boolean}[]) {
  return updateWorkspace(w=>{noActiveRun(w);const role=w.roles.find(r=>r.id===roleId);if(!role) throw new PublicError('Role not found.',404);if(hash(role)!==hash(base)) throw new PublicError('Role changed; regenerate or review the proposals against the current role.',409);
    const before=structuredClone(role);for(const item of items) addProposal(w,role,item.proposal,item.useRelevance,role.recruiterInstructions);role.revision=nextRevision(before,role);validateRole(role,w.questions);return role;
  });
}
export async function applyPlan(roleId:string,base:Role,plan:SearchPlan,request:string) {
  return updateWorkspace(w=>{const role=w.roles.find(r=>r.id===roleId);if(!role) throw new PublicError('Role not found.',404);if(hash(role)!==hash(base)) throw new PublicError('Role changed after this preview. Interpret the request again.',409);
    if(plan.additions.length||plan.changes.length) noActiveRun(w);
    try {validatePlan(plan,role,[...w.questions,relevanceQuestion(role.rubric)]);}catch(e) {throw new PublicError((e as Error).message);}
    if(plan.clarification) throw new PublicError('Clarify the request before applying changes.');
    const before=structuredClone(role);const idMap:Record<string,string>={};
    // Applying a search plan approves its explicit changes; proposed alternatives on new questions remain pending.
    if(plan.changes.some(c=>c.action==='replace')) role.recruiterInstructions+=(role.recruiterInstructions?'\n':'')+request;
    for(const p of plan.additions) idMap[p.question.id]=addProposal(w,role,p,false,request);
    for(const change of plan.changes) {
      const c=role.criteria.find(c=>c.id===change.criterionId)!;
      if(change.action==='disable') c.enabled=false;
      if(change.action==='enable') {c.enabled=true;c.approved=true;}
      if(change.action==='replace') {c.text=change.text!;c.source={kind:'recruiter',quote:request};c.approved=true;c.enabled=true;c.alternatives=change.alternatives.map(text=>({text,approved:true}));}
    }
    role.filter=plan.filter?structuredClone(plan.filter):role.filter;
    for(const g of role.filter?.groups??[]) for(const c of g.conditions) c.questionId=idMap[c.questionId]??c.questionId;
    role.revision=nextRevision(before,role);validateRole(role,w.questions);return {role,needsEvaluation:plan.additions.length>0||role.revision!==before.revision};
  });
}
export async function verifyConnections() {
  const results=await Promise.allSettled([verifyJev(),verifyOpenRouter()]);
  const jev=results[0];if(jev.status==='fulfilled') await updateWorkspace(w=>{noActiveRun(w);w.resolvedModel=jev.value.model;w.verifiedRequestedModel=requestedModel();});
  return {jev:jev.status==='fulfilled'?{ok:true,...jev.value}:{ok:false,error:jev.reason instanceof PublicError?jev.reason.message:'JEV verification failed.'},openrouter:results[1].status==='fulfilled'?{ok:true,...results[1].value}:{ok:false,error:results[1].reason instanceof PublicError?results[1].reason.message:'OpenRouter verification failed.'}};
}
