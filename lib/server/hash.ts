import { createHash } from 'node:crypto';
export function canonical(value:unknown):string {
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value);
}
export function hash(value:unknown) {return createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');}
