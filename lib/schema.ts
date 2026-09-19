import { z } from 'zod';

export const safeId = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/).refine(s => !['__proto__', 'constructor', 'prototype'].includes(s), 'Reserved ID');
export const optionSchema = z.object({ id: safeId, description: z.string().trim().min(1).max(3000) }).strict();
export const questionSchema = z.object({
  id: safeId, version: z.number().int().positive(), group: z.enum(['Work performed', 'Experience detail', 'Writing diagnostics', 'Role questions']),
  title: z.string().trim().min(1).max(200), instructions: z.string().trim().min(10).max(10000),
  primitive: z.enum(['noul', 'score', 'choice']), levels: z.array(z.string().trim().min(1).max(3000)).max(10),
  options: z.array(optionSchema).max(255), scope: z.enum(['general', 'role']), experimental: z.boolean(),
}).strict().superRefine((q, ctx) => {
  if (q.primitive === 'score' && q.levels.length < 2) ctx.addIssue({ code: 'custom', message: 'Score requires 2–10 descriptive levels.' });
  if (q.primitive === 'choice' && q.options.length < 2) ctx.addIssue({ code: 'custom', message: 'Choice requires at least two descriptive options.' });
  if (new Set(q.options.map(o => o.id)).size !== q.options.length) ctx.addIssue({code:'custom',message:'Duplicate choice IDs.'});
  if (q.group === 'Writing diagnostics' && q.scope !== 'general') ctx.addIssue({code:'custom',message:'Writing diagnostics must remain general attributes.'});
});
export type Question = z.infer<typeof questionSchema>;
export const sourceSchema = z.object({ kind: z.enum(['jd', 'recruiter']), quote: z.string().trim().min(1).max(12000) }).strict();
export const criterionSchema = z.object({
  id: safeId, questionId: safeId.nullable(), text: z.string().trim().min(1).max(6000), status: z.enum(['required','preferred','unspecified']),
  source: sourceSchema, approved: z.boolean(), enabled: z.boolean(), alternatives: z.array(z.object({text:z.string().trim().min(1).max(2000),approved:z.boolean()}).strict()).max(30),
}).strict();
export type Criterion = z.infer<typeof criterionSchema>;
export const conditionSchema = z.object({ questionId:safeId, operator:z.enum(['gte','lte','eq','neq']), value:z.union([z.number(),z.string().max(200)]) }).strict();
export const filterSchema = z.object({ join:z.enum(['and','or']), groups:z.array(z.object({join:z.enum(['and','or']),conditions:z.array(conditionSchema).min(1).max(20)}).strict()).max(20), includeUnknown:z.boolean() }).strict();
export type AnswerFilter = z.infer<typeof filterSchema>;
export const roleSchema = z.object({
  id:safeId, name:z.string().trim().min(1).max(200), jd:z.string().max(60000), recruiterInstructions:z.string().max(12000), revision:z.number().int().positive(),
  criteria:z.array(criterionSchema).max(100), rubric:z.array(z.string().trim().min(1).max(3000)).min(2).max(10),
  questionIds:z.array(safeId).max(200), filter:filterSchema.nullable(),
}).strict();
export type Role = z.infer<typeof roleSchema>;
export const proposalSchema = z.object({
  question: questionSchema, reuseQuestionId:safeId.nullable(), criterion:z.string().trim().min(1).max(6000),
  status:z.enum(['required','preferred','unspecified']),source:sourceSchema, alternatives:z.array(z.string().trim().min(1).max(2000)).max(10),
}).strict();
export type Proposal = z.infer<typeof proposalSchema>;
export const proposalsSchema = z.object({proposals:z.array(proposalSchema).min(1).max(10)}).strict();
export const planSchema = z.object({
  summary:z.string().min(1).max(4000),clarification:z.string().min(1).max(4000).nullable(),filter:filterSchema.nullable(),additions:z.array(proposalSchema).max(10),
  changes:z.array(z.object({criterionId:safeId,action:z.enum(['enable','disable','replace']),text:z.string().min(1).max(6000).nullable(),alternatives:z.array(z.string().min(1).max(2000)).max(10)}).strict()).max(30),
}).strict();
export type SearchPlan = z.infer<typeof planSchema>;
export type Candidate = {id:string;name:string;text:string;paragraphs:{id:string;text:string}[];hash:string;bookmarked:boolean;fictional:boolean};
const probability = z.number().finite().min(0).max(1);
export const answerSchema = z.discriminatedUnion('type',[
  z.object({type:z.literal('noul'),noul:probability}).strict(),
  z.object({type:z.literal('score'),score:z.number().finite(),confidence:probability,legend:z.record(z.string(),z.string()),probabilities:z.record(z.string(),probability)}).strict(),
  z.object({type:z.literal('choice'),choice:z.string(),confidence:probability,probabilities:z.record(z.string(),probability)}).strict(),
]);
export type Answer = z.infer<typeof answerSchema>;
export const responseSchema = z.object({model:z.string().min(1),answers:z.record(z.string(),answerSchema),usage:z.object({input_tokens:z.number().nonnegative(),output_tokens:z.number().nonnegative()}).passthrough().optional()}).passthrough();
export type JevResponse = z.infer<typeof responseSchema>;
export type StoredAnswer = {key:string;question:Question;answer:Answer;model:string;stateHash:string;createdAt:string;roleRevision:number|null;roleId:string|null};
export type Evidence = {answerKey:string;model:string;retrievedAt:string;exists:number;selectedId:string|null;passages:{id:string;probability:number}[];native:JevResponse};
export type CandidateResults = {cacheSchemaVersion?:2;answers:Record<string,StoredAnswer>;evidence:Record<string,Evidence>};
export type RunItem = {status:'pending'|'running'|'complete'|'failed';error?:string;retryAfterUntil?:number;cacheHits:number;inputTokens:number;outputTokens:number};
export type Run = {id:string;role:Role;questions:Question[];model:string;candidateIds:string[];items:Record<string,RunItem>;status:'running'|'paused'|'complete';createdAt:string;asOfDate?:string;elapsedMs:number};
export type Workspace = {schemaVersion:1;questionSelectionVersion?:1;version:number;candidates:Candidate[];questions:Question[];roles:Role[];activeRoleId:string;resolvedModel:string|null;verifiedRequestedModel:string|null;run:Run|null};
export type CandidateView = {candidate:Candidate;answers:Record<string,StoredAnswer>;oldAnswers:StoredAnswer[];score:number|null;status:'current'|'pending'|'stale'|'failed'|'insufficient';error?:string};
