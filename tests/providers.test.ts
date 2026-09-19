import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { decodeJevTool } from '../lib/server/jev';
import { generateQuestions,interpretSearch,quotationWarnings,retryAfterSeconds,structured } from '../lib/server/openrouter';
import { initialQuestions } from '../lib/registry';
import { sampleRoles } from '../lib/fixtures';
import { PublicError,safeError } from '../lib/server/errors';
beforeEach(()=>{vi.stubEnv('OPENROUTER_API_KEY','test-only-fake-key');vi.stubEnv('OPENROUTER_MODEL','openai/gpt-4.1-mini');delete (globalThis as {orVerified?:unknown}).orVerified;delete (globalThis as {orCooldown?:unknown}).orCooldown;});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function installFetch(contents:unknown[]) {
  const calls:{url:string;body?:Record<string,unknown>}[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{calls.push({url,body:init?.body?JSON.parse(String(init.body)):undefined});if(url.endsWith('/models')) return Response.json({data:[{id:'openai/gpt-4.1-mini',supported_parameters:['structured_outputs']}]});const content=contents.shift();return Response.json({model:'openai/gpt-4.1-mini',choices:[{message:{content:typeof content==='string'?content:JSON.stringify(content)}}],usage:{prompt_tokens:10,completion_tokens:10}});}));return calls;
}
describe('OpenRouter generation with mocked HTTP',()=>{
  it('requires structured supporting endpoints and repairs once',async()=>{const calls=installFetch(['bad',{answer:'okay'}]);const result=await structured(z.object({answer:z.string()}).strict(),'test',{task:'fictional'});expect(result.value.answer).toBe('okay');const chats=calls.filter(c=>c.body);expect(chats).toHaveLength(2);expect(chats[0].body?.provider).toEqual({require_parameters:true,allow_fallbacks:false});expect(chats[0].body?.response_format).toHaveProperty('type','json_schema');});
  it('fails clearly after at most one repair without silently switching models',async()=>{const calls=installFetch(['bad','still bad','must not be used']);await expect(structured(z.object({answer:z.string()}),'test',{})).rejects.toThrow('one repair');expect(calls.filter(c=>c.body)).toHaveLength(2);expect(calls.filter(c=>c.body).every(c=>c.body?.model==='openai/gpt-4.1-mini')).toBe(true);});
  it('question generation includes no candidate pool and mismatched quotations are flagged',async()=>{const p={question:initialQuestions[0],reuseQuestionId:initialQuestions[0].id,criterion:'Describe personal work',status:'unspecified',source:{kind:'jd',quote:'not in JD'},alternatives:[]};const calls=installFetch([{proposals:Array.from({length:6},()=>p)}]);const r=await generateQuestions(sampleRoles[0],initialQuestions);expect(quotationWarnings(r.value.proposals,sampleRoles[0])[0]).toContain('does not match');const body=calls.find(c=>c.body)?.body;expect(JSON.stringify(body)).not.toContain('Alex Morgan');expect(JSON.stringify(body)).not.toContain('candidatePool');});
  it('natural language interpretation validates unknown IDs',async()=>{installFetch([{summary:'x',clarification:null,filter:null,additions:[],changes:[{criterionId:'invented',action:'disable',text:null,alternatives:[]}]},{summary:'x',clarification:null,filter:null,additions:[],changes:[{criterionId:'invented',action:'disable',text:null,alternatives:[]}]}]);await expect(interpretSearch('disable invented',sampleRoles[0],initialQuestions)).rejects.toThrow('one repair');});
  it('honors Retry-After without retry storms or leaked bodies',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response('secret provider body',{status:429,headers:{'Retry-After':'10'}})));await expect(structured(z.object({answer:z.string()}),'test',{})).rejects.toMatchObject({status:429,retryAfter:10});expect(retryAfterSeconds('3')).toBe(3);expect(retryAfterSeconds('Wed, 01 Jan 2031 00:00:10 GMT',Date.parse('2031-01-01T00:00:00Z'))).toBe(10);});
});
describe('typed MCP response boundary and secret isolation',()=>{
  it('uses structured MCP output without adding a noul confidence',()=>{const r=decodeJevTool({structuredContent:{model:'jev-1.13.0',answers:{x:{type:'noul',noul:0.5}}}});expect(r.answers.x).toEqual({type:'noul',noul:0.5});expect(()=>decodeJevTool({structuredContent:{model:'x',answers:{x:{type:'noul',noul:4}}}})).toThrow('invalid');});
  it('sanitizes provider errors and never fabricates an answer',()=>{const secret='sk-test-secret-resume';try {decodeJevTool({isError:true,content:[{type:'text',text:`HTTP 401 ${secret}`}]});}catch(e){expect(safeError(e)).not.toContain(secret);expect(safeError(e)).toContain('authentication');}expect(safeError(new Error(secret))).not.toContain(secret);expect(safeError(new PublicError('Safe message'))).toBe('Safe message');});
  it('client modules cannot read server credentials',async()=>{for(const file of ['components/workspace.tsx','lib/logic.ts','lib/schema.ts','lib/registry.ts']) {const code=await readFile(file,'utf8');expect(code).not.toMatch(/process\.env|NEXT_PUBLIC_.*KEY/);}for(const file of ['lib/server/jev.ts','lib/server/openrouter.ts']) expect(await readFile(file,'utf8')).toContain("import 'server-only'");});
});
