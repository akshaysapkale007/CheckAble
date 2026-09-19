import type { Answer, AnswerFilter, CandidateView, Criterion, Question, Role, SearchPlan } from './schema';
import { isolation } from './registry';
import { assessmentDate } from './shared-questions';
import type { Question as ProviderQuestion } from '@typesafe-ai/sdk';
export function activeBrief(role:Role) {
  return role.criteria.filter(c=>c.approved&&c.enabled).map(c=>`[${c.status}] ${c.text}${c.alternatives.filter(a=>a.approved).map(a=>`\nAccepted alternative: ${a.text}`).join('')}`).join('\n\n');
}
export function relevanceIdentity(role:Role) {return JSON.stringify({brief:activeBrief(role),rubric:role.rubric});}
export function nextRevision(before:Role,after:Role) {return before.revision+(relevanceIdentity(before)!==relevanceIdentity(after)?1:0);}
export function sourceMatches(source:Criterion['source'],jd:string,recruiterInstructions:string) {
  return (source.kind==='jd'?jd:recruiterInstructions).includes(source.quote);
}
export function providerQuestion(q:Question,today=assessmentDate()):ProviderQuestion {
  const instructions=q.instructions.replaceAll('{{today}}',today)+isolation;
  if(q.primitive==='noul') return {type:'noul' as const,instructions};
  if(q.primitive==='score') return {type:'score' as const,instructions,criteria:q.levels as [string,string,...string[]]};
  return {type:'choice' as const,instructions,criteria:Object.fromEntries(q.options.map(o=>[o.id,o.description]))};
}
export function evaluationState(text:string,role:Role|undefined):Record<string,string> {
  return role?{resume:text,approved_active_role_brief:activeBrief(role)}:{resume:text};
}
export function compareViews(a:CandidateView,b:CandidateView) {
  if(a.score===null&&b.score!==null) return 1;
  if(a.score!==null&&b.score===null) return -1;
  return (b.score??0)-(a.score??0) || (a.candidate.id<b.candidate.id?-1:a.candidate.id>b.candidate.id?1:0);
}
type Truth=true|false|null;
function combine(values:Truth[],join:'and'|'or'):Truth {
  if(join==='and') return values.includes(false)?false:values.includes(null)?null:true;
  return values.includes(true)?true:values.includes(null)?null:false;
}
export function matchesFilter(answers:Record<string,Answer>,filter:AnswerFilter|null) {
  if(!filter?.groups.length) return true;
  const result=combine(filter.groups.map(g=>combine(g.conditions.map(c=>{
    const a=answers[c.questionId]; if(!a) return null;
    const value=a.type==='noul'?a.noul:a.type==='score'?a.score:a.choice;
    if(c.operator==='eq') return value===c.value;
    if(c.operator==='neq') return value!==c.value;
    if(typeof value!=='number'||typeof c.value!=='number') return null;
    return c.operator==='gte'?value>=c.value:value<=c.value;
  }),g.join)),filter.join);
  return result===null?filter.includeUnknown:result;
}
export function validateFilter(filter:AnswerFilter|null,questions:Question[]) {
  for(const g of filter?.groups??[]) for(const c of g.conditions) {
    const q=questions.find(q=>q.id===c.questionId); if(!q) throw new Error(`Unknown filter question: ${c.questionId}`);
    if(q.primitive==='choice') {
      if(!['eq','neq'].includes(c.operator)||typeof c.value!=='string'||!q.options.some(o=>o.id===c.value)) throw new Error(`Invalid choice filter for ${q.title}.`);
    } else if(typeof c.value!=='number'||c.value<0||c.value>(q.primitive==='noul'?1:q.levels.length-1)) throw new Error(`Invalid cutoff for ${q.title}.`);
  }
}
export function filterLabel(filter:AnswerFilter|null,questions:Question[]) {
  if(!filter?.groups.length) return 'All answers';
  const symbols={gte:'≥',lte:'≤',eq:'=',neq:'≠'};
  return filter.groups.map(g=>'('+g.conditions.map(c=>`${questions.find(q=>q.id===c.questionId)?.title??c.questionId} ${symbols[c.operator]} ${c.value}`).join(` ${g.join.toUpperCase()} `)+')').join(` ${filter.join.toUpperCase()} `);
}
export function validatePlan(plan:SearchPlan,role:Role,questions:Question[]) {
  const additions=plan.additions.map(p=>p.question);
  validateFilter(plan.filter,[...questions,...additions]);
  for(const c of plan.changes) {
    if(!role.criteria.some(r=>r.id===c.criterionId)) throw new Error('Search plan refers to an unknown role criterion.');
    if(c.action==='replace'&&!c.text?.trim()) throw new Error('Replacement criterion is empty.');
  }
  for(const p of plan.additions) if(p.reuseQuestionId&&!questions.some(q=>q.id===p.reuseQuestionId)) throw new Error('Search plan reuses an unknown question.');
  if(plan.clarification&&(plan.additions.length||plan.changes.length||plan.filter)) throw new Error('A clarification plan cannot apply changes.');
}
export function answerSummary(a:Answer) {
  if(a.type==='noul') return `P(yes) ${a.noul.toFixed(3)}`;
  if(a.type==='score') return `Score ${a.score.toFixed(2)}`;
  return a.choice.replaceAll('_',' ');
}
