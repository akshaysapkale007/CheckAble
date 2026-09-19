import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Papa from 'papaparse';
import { prepareDataset } from '../lib/dataset';
import { parseImport } from '../lib/imports';
import { emptyWorkspace } from '../lib/server/store';
import { toCandidate } from '../lib/server/workspace';

const output = path.resolve('data/datasets/hackathon');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const counts = (values: string[]) => Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(item => item === value).length]));
async function exists(file: string) { try { await readFile(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }

async function check(directory: string) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  for (const [file, expected] of Object.entries(manifest.files as Record<string, { sha256: string }>)) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(file)) throw new Error('Unsafe manifest path.');
    if (sha(await readFile(path.join(directory, file), 'utf8')) !== expected.sha256) throw new Error(`Checksum mismatch: ${file}`);
  }
  const raw = JSON.parse(await readFile(path.join(directory, 'sources.json'), 'utf8'));
  const rebuilt = prepareDataset(raw);
  if (rebuilt.source.djinni.length !== 500 || rebuilt.source.synthetic_resumes.length !== 500 || rebuilt.roles.length !== 20) throw new Error('Incorrect dataset counts.');
  const candidates = parseImport(await readFile(path.join(directory, 'candidates.json'), 'utf8'), 'json');
  if (JSON.stringify(candidates) !== JSON.stringify(rebuilt.candidates)) throw new Error('Source preservation check failed.');
  const roles = JSON.parse(await readFile(path.join(directory, 'roles.json'), 'utf8'));
  if (JSON.stringify(roles) !== JSON.stringify(rebuilt.roles)) throw new Error('Job mapping check failed.');
  const csv = parseImport(await readFile(path.join(directory, 'candidates.csv'), 'utf8'), 'csv', { id: 'id', name: 'name', text: 'text' });
  if (JSON.stringify(csv) !== JSON.stringify(candidates.map(({ id, name, text }) => ({ id, name, text })))) throw new Error('CSV round-trip failed.');
  const workspace = JSON.parse(await readFile(path.join(directory, 'workspace.json'), 'utf8'));
  if (JSON.stringify(workspace.candidates) !== JSON.stringify(candidates.map(toCandidate)) || JSON.stringify(workspace.roles) !== JSON.stringify(roles) || workspace.run !== null) throw new Error('Workspace template mismatch.');
  console.log('Validated 1,000 unique resumes, 20 draft roles, preserved source fields, JSON/CSV imports, workspace template, and artifact checksums. No model calls.');
}

if (process.argv.includes('--check')) {
  await check(output);
} else if (await exists(path.join(output, 'manifest.json'))) {
  await check(output);
  console.log(`Existing dataset is intact: ${output}`);
} else {
  const stage = `${output}.building-${randomUUID()}`;
  await mkdir(stage, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.PYTHON || 'python', ['scripts/fetch-dataset.py', path.join(stage, 'sources.json')], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Dataset download failed (${code}). Completed cache files are reusable.`)));
  });
  const rawText = await readFile(path.join(stage, 'sources.json'), 'utf8');
  const raw = JSON.parse(rawText);
  const { candidates, roles, source } = prepareDataset(raw);
  if (source.djinni.length !== 500 || source.synthetic_resumes.length !== 500 || roles.length !== 20) throw new Error('Incorrect dataset counts.');
  const workspace = emptyWorkspace();
  workspace.candidates = candidates.map(toCandidate);
  workspace.roles = roles;
  workspace.activeRoleId = roles[0].id;
  const provenance = [
    ...source.djinni.map(({ row, row_index }) => ({ id: `djinni_${row.id}`, source: 'djinni', sourceId: row.id, rowIndex: row_index, textMapping: 'CV copied verbatim', sha256: sha(row.CV) })),
    ...source.synthetic_resumes.map(({ row, row_index }) => ({ id: `synthetic_${row.resume_id}`, source: 'synthetic_resumes', sourceId: row.resume_id, rowIndex: row_index, textMapping: 'All structured resume fields formatted; source values unchanged', sha256: sha(candidates.find(candidate => candidate.id === `synthetic_${row.resume_id}`)!.text) })),
    ...source.synthetic_jobs.map(({ row, row_index }) => ({ id: `synthetic_${row.job_id}`, source: 'synthetic_jobs', sourceId: row.job_id, rowIndex: row_index, textMapping: 'All structured job fields formatted; source values unchanged', sha256: sha(roles.find(role => role.id === `synthetic_${row.job_id}`)!.jd) })),
  ];
  const files: Record<string, string> = {
    'sources.json': rawText,
    'candidates.json': JSON.stringify(candidates, null, 2) + '\n',
    // CSV is the simple three-column interchange format; JSON also carries fictional flags.
    'candidates.csv': Papa.unparse(candidates.map(({ id, name, text }) => ({ id, name, text })), { newline: '\n', quotes: true }),
    'roles.json': JSON.stringify(roles, null, 2) + '\n',
    'jobs.txt': roles.map(role => `SOURCE ID: ${role.id}\n\n${role.jd}`).join('\n\n---JOB---\n\n') + '\n',
    'provenance.json': JSON.stringify(provenance, null, 2) + '\n',
    'workspace.json': JSON.stringify(workspace) + '\n',
  };
  const lengths = candidates.map(candidate => candidate.text.length).sort((a, b) => a - b);
  const manifest = {
    schemaVersion: 1, seed: raw.seed, retrievedAt: raw.retrieved_at, sources: raw.sources, sampling: raw.sampling,
    counts: { djinni: 500, synthetic: 500, candidates: 1000, jobs: 20 },
    textCharacters: { min: lengths[0], median: lengths[500], max: lengths.at(-1) },
    distribution: {
      djinniPrimaryKeyword: counts(source.djinni.map(item => item.row['Primary Keyword'])),
      syntheticRole: counts(source.synthetic_resumes.map(item => item.row.role)),
      syntheticSeniority: counts(source.synthetic_resumes.map(item => item.row.seniority)),
      jobSeniority: counts(source.synthetic_jobs.map(item => item.row.seniority)),
    },
    jobTitleCoverage: source.synthetic_jobs.map(({ row }) => ({ jobId: row.job_id, title: row.job_title, syntheticResumesWithSameTitle: source.synthetic_resumes.filter(item => item.row.role === row.job_title).length })),
    notes: ['Public anonymized Djinni profiles; anonymity is not independently certified.', 'Synthetic source includes Qwen 2.5 generation and deterministic fallbacks per its dataset card.', 'Short resumes are retained; no inferred skills, relevance labels, embeddings, or source match scores are imported.', 'Source labels and provenance are metadata, excluded from assessment state. No model calls were made.', 'Roles have no approved criteria; review or generate criteria before evaluation.', 'Demo sample, not a representative hiring benchmark.'],
    files: Object.fromEntries(Object.entries(files).map(([file, text]) => [file, { bytes: Buffer.byteLength(text), sha256: sha(text) }])),
  };
  for (const [file, text] of Object.entries(files)) await writeFile(path.join(stage, file), text, 'utf8');
  await writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await check(stage);
  // Publish the complete bundle together. Never overwrite an existing bundle or a live workspace.
  await rename(stage, output);
  console.log(`Dataset ready: ${output}\nOpen it with npm run dataset:demo`);
}
