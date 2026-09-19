import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const bundle = path.resolve('data/datasets/hackathon');
const directory = path.resolve('data/hackathon-workspace');
const template = await readFile(path.join(bundle, 'workspace.json'));
const manifest = JSON.parse(await readFile(path.join(bundle, 'manifest.json'), 'utf8'));
if (createHash('sha256').update(template).digest('hex') !== manifest.files['workspace.json'].sha256) throw new Error('Dataset template failed verification. Run npm run dataset:check.');
await mkdir(directory, { recursive: true });
const lockPath = path.join(directory, 'initialize.lock');
const lock = await open(lockPath, 'wx');
try {
  const target = path.join(directory, 'workspace.json');
  let present = false;
  try { await stat(target); present = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (present) console.log('Reusing the dataset workspace, including any saved edits and assessments.');
  else {
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    await writeFile(temporary, template);
    await rename(temporary, target);
    console.log('Created the separate dataset workspace: 1,000 resumes and 20 draft roles.');
  }
} finally {
  await lock.close();
  await unlink(lockPath);
}
const args = process.argv.slice(2);
console.log('Dataset workspace: http://127.0.0.1:3001 (unless overridden with --port)');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3001', ...args], {
  stdio: 'inherit', env: { ...process.env, CANDIDATE_DATA_DIR: directory },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
