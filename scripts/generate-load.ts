import { mkdir, writeFile } from 'node:fs/promises';
import { sampleCandidates } from '../lib/fixtures';
const count=Number(process.argv[2]||1000);
if(!Number.isInteger(count)||count<1||count>10000) throw new Error('Choose 1–10,000 records.');
const rows=Array.from({length:count},(_,i)=>({id:`load_${String(i+1).padStart(5,'0')}`,name:`Fictional load record ${i+1}`,text:`FICTIONAL LOAD TEST — templated record, not an accuracy benchmark.\n\n${sampleCandidates[i%sampleCandidates.length].text}`}));
await mkdir('data',{recursive:true});await writeFile(`data/load-${count}.json`,JSON.stringify(rows,null,2));
console.log(`Created data/load-${count}.json. No provider calls were made. Import manually for batching/UI tests.`);
