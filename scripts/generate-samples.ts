import { mkdir, writeFile } from 'node:fs/promises';
import Papa from 'papaparse';
import { sampleCandidates,sampleRoles } from '../lib/fixtures';
await mkdir('public/samples',{recursive:true});
await writeFile('public/samples/candidates.json',JSON.stringify(sampleCandidates,null,2));
await writeFile('public/samples/candidates.csv',Papa.unparse(sampleCandidates));
await writeFile('public/samples/jobs.json',JSON.stringify(sampleRoles,null,2));
console.log('Wrote 16 fictional resume fixtures and three sample roles.');
