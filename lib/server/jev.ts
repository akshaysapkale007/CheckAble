import 'server-only';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { TypeSafeClient, type SystemOneRequest } from '@typesafe-ai/sdk';
import { responseSchema, type JevResponse } from '../schema';
import { PublicError } from './errors';

export type JevRequest=SystemOneRequest;
export type Decide=(request:JevRequest)=>Promise<JevResponse>;
type Globals=typeof globalThis&{jevConnection?:Promise<Client>;jevActive?:number;jevWaiters?:Array<()=>void>;jevCooldown?:number};
const globals=globalThis as Globals;
export const requestedModel=()=>process.env.TYPESAFE_MODEL?.trim()||'jev-latest';
export const openrouterModel=()=>process.env.OPENROUTER_MODEL?.trim()||'openai/gpt-4.1-mini';
export function concurrency() {const n=Number(process.env.JEV_CONCURRENCY||5);return Number.isFinite(n)?Math.min(10,Math.max(1,Math.floor(n))):5;}
export function configuration() {return {jev:!!process.env.TYPESAFE_API_KEY?.trim()&&!!process.env.JEV_MCP_SERVER?.trim(),openrouter:!!process.env.OPENROUTER_API_KEY?.trim(),jevModel:requestedModel(),openrouterModel:openrouterModel(),transport:'Jev MCP',concurrency:concurrency()};}
async function connection() {
  if(!configuration().jev) throw new PublicError('Set TYPESAFE_API_KEY and JEV_MCP_SERVER on the server, then restart the app.',503);
  if(!globals.jevConnection) globals.jevConnection=(async()=>{
    const script=process.env.JEV_MCP_SERVER!.trim();
    if(!path.isAbsolute(script)) throw new PublicError('JEV_MCP_SERVER must be an absolute path to your configured server script.',503);
    try {await access(script);}catch{throw new PublicError('The configured Jev MCP script could not be found. Check JEV_MCP_SERVER.',503);}
    const env=getDefaultEnvironment();
    for(const key of ['TYPESAFE_API_KEY','TYPESAFE_BASE_URL','TYPESAFE_MODEL']) if(process.env[key]) env[key]=process.env[key]!;
    const metadata=path.resolve('scripts/mcp-metadata.mjs');
    const transport=new StdioClientTransport({command:process.execPath,args:['--import',pathToFileURL(metadata).href,script],cwd:path.dirname(script),env,stderr:'ignore'});
    const client=new Client({name:'checkable',version:'0.1.0'});
    try {await client.connect(transport);const list=await client.listTools();if(!list.tools.some(t=>t.name==='jev_decide')) throw new Error('Missing tool');}
    catch {await transport.close().catch(()=>{});throw new PublicError('Could not connect to jev_decide in your configured MCP server.',503);}
    client.onclose=()=>{globals.jevConnection=undefined;};
    return client;
  })().catch(e=>{globals.jevConnection=undefined;throw e;});
  return globals.jevConnection;
}
export async function closeJev() {if(globals.jevConnection) {const c=await globals.jevConnection;globals.jevConnection=undefined;await c.close();}}
async function limited<T>(fn:()=>Promise<T>):Promise<T> {
  globals.jevWaiters??=[]; globals.jevActive??=0;
  if(globals.jevActive>=concurrency()) await new Promise<void>(resolve=>globals.jevWaiters!.push(resolve));
  else globals.jevActive++;
  try {return await fn();}finally {const next=globals.jevWaiters.shift();if(next) next();else globals.jevActive--;}
}
export function decodeJevTool(rawResult:unknown):JevResponse {
  if(!rawResult||typeof rawResult!=='object') throw new PublicError('Jev MCP returned an unreadable response.',502);
  const result=rawResult as {isError?:boolean;structuredContent?:unknown;content?:unknown};
  if(result.isError) {
    // Never forward provider bodies: they can echo resume text or credentials.
    const diagnostic=Array.isArray(result.content)?result.content.map(b=>b&&typeof b==='object'&&'text' in b?String(b.text):'').join('\n'):'';
    const code=diagnostic.match(/HTTP (\d{3})/)?.[1];
    const retry=Number(diagnostic.match(/"retry_after_seconds"\s*:\s*(\d+(?:\.\d+)?)/)?.[1]??0);
    if(retry) globals.jevCooldown=Date.now()+retry*1000;
    throw new PublicError(code==='429'?`JEV rate limit reached. ${retry?`Wait ${Math.ceil(retry)} seconds, then retry failed items.`:'Retry failed items later.'}`:code==='401'||code==='403'?'JEV authentication failed. Check the server credential.':`Jev MCP could not assess this record${code?` (HTTP ${code})`:''}. Retry the item or check the configured server.`,code==='429'?429:502,retry||undefined);
  }
  let raw=result.structuredContent;
  if(!raw&&Array.isArray(result.content)) {
    const block=result.content.find((b:unknown)=>!!b&&typeof b==='object'&&'type' in b&&b.type==='text') as {text:string}|undefined;
    try {raw=JSON.parse(block?.text??'');}catch{throw new PublicError('Jev MCP returned an unreadable response.',502);}
  }
  const parsed=responseSchema.safeParse(raw);
  if(!parsed.success) throw new PublicError('Jev MCP returned an invalid typed answer. No score was assigned.',502);
  return parsed.data;
}
export const decide:Decide=async request=>limited(async()=>{
  if((globals.jevCooldown??0)>Date.now()) throw new PublicError('JEV requested a cooldown. Retry failed items after the provider wait.',429,Math.ceil((globals.jevCooldown!-Date.now())/1000));
  try {const client=await connection();return decodeJevTool(await client.callTool({name:'jev_decide',arguments:{state:request.state,questions:request.questions,model:request.model??requestedModel()}},undefined,{timeout:65000}));}
  catch(e) {if(e instanceof PublicError) throw e;throw new PublicError('The Jev MCP connection timed out or closed. Completed answers are saved; retry this item.',502);}
});
export async function verifyJev() {
  if(!configuration().jev) throw new PublicError('Configure TYPESAFE_API_KEY and JEV_MCP_SERVER before evaluation.',503);
  const model=requestedModel();
  // SDK is used for account model discovery only; every judgment goes through Jev MCP.
  try {
    const client=new TypeSafeClient({logLevel:'off',retry:{maxRetries:0},timeout:15000});
    const models=await client.models.list();
    if(!models.some(m=>m.name===model)&&!/^jev-\d+(?:\.\d+){1,2}$/.test(model)) throw new PublicError(`Configured JEV model ${model} is unavailable. No model was substituted.`,400);
  }catch(e) {if(e instanceof PublicError) throw e;throw new PublicError('Could not verify your TypeSafe model access. Check the credential and connection.',502);}
  const response=await decide({model,state:{text:'Fictional connection check: a developer wrote automated tests.'},questions:{connection_check:{type:'noul',instructions:'Does the supplied fictional text state that a developer wrote automated tests?'}}});
  if(!response.model.startsWith('jev-')||(!['jev-latest','jev-preview'].includes(model)&&response.model!==model)) throw new PublicError('JEV returned an unexpected model version. Evaluation is unavailable until configuration is corrected.',502);
  return {model:response.model,requestedModel:model,usage:response.usage};
}
