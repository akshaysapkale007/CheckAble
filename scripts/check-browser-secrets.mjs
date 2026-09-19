import { readdir,readFile } from 'node:fs/promises';
import path from 'node:path';
const secrets=['TYPESAFE_API_KEY','OPENROUTER_API_KEY'].map(k=>process.env[k]).filter(v=>v&&v.length>8);
let files=0;
async function scan(directory) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const filename=path.join(directory,entry.name);
    if(entry.isDirectory()) await scan(filename);
    else {const text=await readFile(filename,'utf8');files++;if(secrets.some(value=>text.includes(value))) throw new Error('A configured secret was detected in a browser asset. Values are not printed.');}
  }
}
await scan('.next/static');
console.log(`Checked ${files} browser assets against ${secrets.length} configured credentials: no secret values found.`);
