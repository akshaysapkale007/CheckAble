import Papa from 'papaparse';
import { z } from 'zod';
import { safeId } from './schema';
export const MAX_UPLOAD_BYTES=20*1024*1024;
export const MAX_RESUME_CHARS=100000;
const rowSchema=z.object({id:safeId,name:z.string().max(300).optional(),text:z.string().min(1).max(MAX_RESUME_CHARS),fictional:z.boolean().optional()}).strip();
export type ImportRow=z.infer<typeof rowSchema>;
export function parseCsv(content:string) {
  const parsed=Papa.parse<Record<string,string>>(content,{header:true,skipEmptyLines:'greedy'});
  if(parsed.errors.length) throw new Error(`CSV could not be read: ${parsed.errors[0].message}`);
  if(!parsed.meta.fields?.length || new Set(parsed.meta.fields).size!==parsed.meta.fields.length || Object.keys(parsed.meta.renamedHeaders||{}).length) throw new Error('CSV needs unique column headings.');
  return {columns:parsed.meta.fields,rows:parsed.data};
}
export function parseImport(content:string,format:'json'|'csv'|'text',mapping?:{id:string;name?:string;text:string},existingIds:string[]=[]) : ImportRow[] {
  if(new TextEncoder().encode(content).length>MAX_UPLOAD_BYTES) throw new Error('Upload exceeds the 20 MB limit. Split the source into smaller files.');
  let raw:unknown;
  if(format==='json') {try {raw=JSON.parse(content.replace(/^\uFEFF/,''));}catch{throw new Error('Invalid JSON. Use an array of { id, name, text } records.');}}
  else if(format==='csv') {
    const {columns,rows}=parseCsv(content);
    if(!mapping || !columns.includes(mapping.id) || !columns.includes(mapping.text) || (mapping.name && !columns.includes(mapping.name))) throw new Error('Select valid ID and resume-text columns.');
    raw=rows.map(r=>({id:r[mapping.id],name:mapping.name?r[mapping.name]:undefined,text:r[mapping.text]}));
  } else {
    // Explicit delimiter: one resume per block. Blank lines remain part of the original text.
    const blocks=content.split(/\r?\n---CANDIDATE---\r?\n/);
    let next=1; const used=new Set(existingIds);
    raw=blocks.map(text=>{while(used.has(`text-${next}`)) next++; const id=`text-${next++}`;used.add(id);return {id,name:id,text};});
  }
  const parsed=z.array(rowSchema).min(1).max(10000).safeParse(raw);
  if(!parsed.success) throw new Error('Invalid records: require a unique ID (letters, digits, _ or -), optional name, and 1–100,000 characters of resume text. Maximum 10,000 records per upload.');
  const seen=new Set(existingIds);
  for(const r of parsed.data) {
    if(!r.text.trim()) throw new Error(`Resume ${r.id} has empty text.`);
    if(seen.has(r.id)) throw new Error(`Duplicate candidate ID: ${r.id}. No records were imported.`);
    seen.add(r.id);
  }
  return parsed.data;
}
export function paragraphs(text:string) {
  return text.split(/\r?\n\s*\r?\n/).filter(s=>s.trim()).map((text,i)=>({id:`p${String(i+1).padStart(4,'0')}`,text}));
}
