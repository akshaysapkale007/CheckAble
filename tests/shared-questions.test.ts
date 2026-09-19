import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sharedResumeQuestions } from '../lib/shared-questions';
import { initialQuestions } from '../lib/registry';
import { sampleRoles } from '../lib/fixtures';
import { questionSchema, type JevResponse } from '../lib/schema';
import { providerQuestion } from '../lib/logic';
import { batch, buildView, controlRun, keyFor, listCandidates, requiredQuestions, startRun } from '../lib/server/evaluation';
import { emptyWorkspace, readResults, readWorkspace, updateWorkspace } from '../lib/server/store';
import { saveQuestion, saveRole, toCandidate } from '../lib/server/workspace';
import type { Decide } from '../lib/server/jev';

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'shared-resume-test-'));
  vi.stubEnv('CANDIDATE_DATA_DIR', folder);
  vi.stubEnv('TYPESAFE_MODEL', 'jev-latest');
  await updateWorkspace(w => {
    w.candidates = [toCandidate({ id: 'shared-fixture', text: 'FICTIONAL TEST. Built APIs from January 2020 to present. Mentored two engineers.' })];
    w.resolvedModel = 'jev-test';
    w.verifiedRequestedModel = 'jev-latest';
  });
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  const resolved = path.resolve(folder);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('shared-resume-test-')) throw new Error('Unsafe cleanup target');
  await rm(resolved, { recursive: true, force: true });
});
const mock: Decide = async request => {
  const answers: JevResponse['answers'] = {};
  for (const [id, q] of Object.entries(request.questions)) {
    if (q.type === 'noul') answers[id] = { type: 'noul', noul: .8 };
    else if (q.type === 'score') answers[id] = { type: 'score', score: 2, confidence: 1, legend: Object.fromEntries(q.criteria.map((v, i) => [i, String(v)])), probabilities: Object.fromEntries(q.criteria.map((_, i) => [i, i === 2 ? 1 : 0])) };
    else { const keys = Object.keys(q.criteria); const choice = keys.includes('enough_detail') ? 'enough_detail' : keys[0]; answers[id] = { type: 'choice', choice, confidence: 1, probabilities: Object.fromEntries(keys.map(k => [k, k === choice ? 1 : 0])) }; }
  }
  return { model: request.model!, answers };
};

describe('shared resume set with mocked assessments', () => {
  it('uses the requested seven definitions with the actual assessment date', () => {
    expect(sharedResumeQuestions.map(q => q.id)).toEqual(['years_of_experience', 'technical_depth', 'mentorship_demonstrated', 'llm_experience', 'certifications_opensource', 'career_progression', 'primary_talent_profile']);
    sharedResumeQuestions.forEach(q => expect(questionSchema.safeParse(q).success).toBe(true));
    expect(providerQuestion(sharedResumeQuestions[0], '2026-09-19').instructions).toContain('Today: 2026-09-19');
    expect(sharedResumeQuestions.slice(0, 2).map(q => q.levels.length)).toEqual([6, 6]);
  });

  it('evaluates without approved role criteria and reuses the whole bundle in a second role', async () => {
    const w = await readWorkspace();
    const adapter = vi.fn(mock);
    await batch((await startRun(w.roles[0].id)).id, adapter);
    expect(adapter).toHaveBeenCalledTimes(1);
    const request = adapter.mock.calls[0][0];
    expect(Object.keys(request.questions)).toEqual(requiredQuestions(w, w.roles[0]).map(q => q.id));
    expect(request.questions).toHaveProperty('personal_task');
    expect(request.questions).toHaveProperty('applied_skills');
    expect(request.state).not.toHaveProperty('approved_active_role_brief');
    expect(request.questions).not.toHaveProperty('role_relevance');
    const list = await listCandidates(w.roles[0].id, 1, 'current');
    expect(list.counts.current).toBe(1);
    expect(list.rows[0].score).toBeNull();
    await batch((await startRun(w.roles[1].id)).id, adapter);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect((await readWorkspace()).run?.items['shared-fixture'].cacheHits).toBe(requiredQuestions(w, w.roles[1]).length);
  });

  it('requires only assessability when selections are empty and keeps shared definitions reusable', async () => {
    const w = await readWorkspace();
    expect(requiredQuestions(w, { ...w.roles[0], questionIds: [] }).map(q => q.id)).toEqual(['assessability']);
    await expect(saveQuestion({ ...sharedResumeQuestions[0], scope: 'role' })).rejects.toThrow('must stay general');
  });

  it('seeds the seven shared questions alongside the previous explicit role selections', () => {
    const w = emptyWorkspace();
    expect(w.questionSelectionVersion).toBe(1);
    expect(w.questions).toHaveLength(23);
    w.roles.forEach((role, i) => expect(role.questionIds).toEqual([...new Set([...sharedResumeQuestions.map(q => q.id), ...sampleRoles[i].questionIds])]));
  });

  it('evaluates selected original-library questions and never implicitly re-enables shared questions', async () => {
    const w = await readWorkspace();
    const selected = await saveRole({ ...w.roles[0], questionIds: ['process_improvement', 'formulaic'] }, w.roles[0]);
    const adapter = vi.fn(mock);
    const run = await startRun(selected.id);
    expect(run.questions.map(q => q.id)).toEqual(['process_improvement', 'assessability', 'formulaic']);
    await batch(run.id, adapter);
    expect(Object.keys(adapter.mock.calls[0][0].questions)).toEqual(['process_improvement', 'assessability', 'formulaic']);
    await updateWorkspace(w => { w.candidates[0].bookmarked = true; });
    const reread = await readWorkspace();
    expect(reread.roles[0].questionIds).toEqual(selected.questionIds);
    expect(requiredQuestions(reread, reread.roles[0]).map(q => q.id)).toEqual(run.questions.map(q => q.id));
  });

  it('preserves cached answers through deselection and reuses them after selection in another role', async () => {
    const w = await readWorkspace();
    const adapter = vi.fn(mock);
    await batch((await startRun(w.roles[0].id)).id, adapter);
    const before = await readResults(w.candidates[0].id);
    const unselected = await saveRole({ ...w.roles[0], questionIds: [] }, w.roles[0]);
    await batch((await startRun(unselected.id)).id, adapter);
    expect(adapter).toHaveBeenCalledTimes(1);
    const view = buildView(w.candidates[0], await readResults(w.candidates[0].id), unselected, requiredQuestions(w, unselected), 'jev-test', null);
    expect(Object.keys(view.answers)).toEqual(['assessability']);
    expect(view.oldAnswers.some(a => a.question.id === 'personal_task')).toBe(true);
    expect(await readResults(w.candidates[0].id)).toEqual(before);
    const otherRole = await saveRole({ ...w.roles[1], questionIds: ['personal_task', 'technical_depth'] }, w.roles[1]);
    await batch((await startRun(otherRole.id)).id, adapter);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect((await readWorkspace()).run?.items['shared-fixture'].cacheHits).toBe(3);
  });

  it('includes native relevance only when the role has approved enabled criteria', async () => {
    const w = await readWorkspace();
    const selected = { ...w.roles[0], questionIds: [] };
    expect(requiredQuestions(w, selected).map(q => q.id)).toEqual(['assessability']);
    selected.criteria[0].approved = true;
    expect(requiredQuestions(w, selected).map(q => q.id)).toEqual(['assessability', 'role_relevance']);
    selected.criteria[0].enabled = false;
    expect(requiredQuestions(w, selected).map(q => q.id)).toEqual(['assessability']);
  });

  it('refreshes only date-dependent answers on a new day and preserves the old result', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
    const w = await readWorkspace(), role = w.roles[0];
    const adapter = vi.fn(mock);
    await batch((await startRun(role.id)).id, adapter);
    const before = await readResults(w.candidates[0].id);
    const oldKey = keyFor(w.candidates[0], sharedResumeQuestions[0], role, 'jev-test');
    expect(before.answers[oldKey].question.instructions).toContain('2026-09-19');
    vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
    const view = buildView(w.candidates[0], before, role, requiredQuestions(w, role), 'jev-test', null);
    expect(view.status).toBe('stale');
    expect(view.answers.years_of_experience).toBeUndefined();
    expect(view.answers.technical_depth).toBeDefined();
    expect(view.oldAnswers.map(a => a.key)).toContain(oldKey);
    await batch((await startRun(role.id)).id, adapter);
    expect(Object.keys(adapter.mock.calls[1][0].questions)).toEqual(['years_of_experience']);
    expect(Object.keys((await readResults(w.candidates[0].id)).answers)).toHaveLength(requiredQuestions(w, role).length + 1);
  });

  it('does not resume a dated run on a later day', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-19T12:00:00Z'));
    const w = await readWorkspace();
    const run = await startRun(w.roles[0].id);
    await controlRun(run.id, 'pause');
    vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
    await expect(controlRun(run.id, 'resume')).rejects.toThrow('assessment date changed');
  });

  it('does not paint insufficient resumes as saved when answers are missing or a run failed', async () => {
    const w=await readWorkspace(), role=w.roles[0];
    const adapter:Decide=async request=>{const response=await mock(request);if(response.answers.assessability?.type==='choice') response.answers.assessability={type:'choice',choice:'insufficient_detail',confidence:1,probabilities:{enough_detail:0,insufficient_detail:1,damaged_text:0}};return response;};
    await batch((await startRun(role.id)).id,adapter);
    expect((await listCandidates(role.id,1,'all')).scanItems[0].status).toBe('complete');
    await saveQuestion({...sharedResumeQuestions[1],instructions:'Rate the complexity of the engineering work actually described.'});
    const changed=await listCandidates(role.id,1,'all');
    expect(changed.rows[0].status).toBe('insufficient');
    expect(changed.scanItems[0].status).toBe('pending');
    await updateWorkspace(w=>{w.run!.items['shared-fixture'].status='failed';});
    expect((await listCandidates(role.id,1,'all')).scanItems[0].status).toBe('pending');
    expect((await readWorkspace()).run?.items['shared-fixture'].status).toBe('failed');
  });

  it('keeps old failures in run history without marking a changed selection as failed', async () => {
    const w = await readWorkspace();
    await batch((await startRun(w.roles[0].id)).id, mock);
    const custom = { ...initialQuestions[0], id: 'new_question', title: 'New question' };
    await saveQuestion(custom);
    const expanded = await saveRole({ ...w.roles[0], questionIds: [...w.roles[0].questionIds, custom.id] }, w.roles[0]);
    const failure = vi.fn<Decide>(async () => { throw new Error('Simulated provider failure'); });
    await batch((await startRun(expanded.id)).id, failure);
    expect((await listCandidates(expanded.id, 1, 'all')).rows[0].status).toBe('failed');
    const restored = await saveRole({ ...expanded, questionIds: w.roles[0].questionIds }, expanded);
    expect(restored.revision).toBe(expanded.revision);
    const list = await listCandidates(restored.id, 1, 'all');
    expect(list.rows[0].status).toBe('current');
    expect(list.scanItems[0].status).toBe('complete');
    expect((await readWorkspace()).run?.items['shared-fixture'].status).toBe('failed');
    expect(failure).toHaveBeenCalledTimes(1);
  });

  it('restores the full library and migrates selections once without losing edits, results or run history', async () => {
    const w = await readWorkspace();
    await batch((await startRun(w.roles[0].id)).id, mock);
    const completed = await readWorkspace();
    const results = await readResults(w.candidates[0].id);
    const edited = { ...sharedResumeQuestions[1], version: 4, title: 'Our engineering depth question' };
    const editedOriginal = { ...initialQuestions[0], version: 3, instructions: 'Does the resume show a specific task that the candidate personally completed?' };
    const custom = { ...initialQuestions[0], id: 'custom_skill', title: 'Our skill question' };
    completed.questions = [edited, editedOriginal, custom];
    completed.roles[0].questionIds = ['personal_task', custom.id];
    completed.version = 27;
    delete completed.questionSelectionVersion;
    await writeFile(path.join(folder, 'workspace.json'), JSON.stringify(completed));
    const migrated = await readWorkspace();
    expect(migrated.questions.find(q => q.id === edited.id)).toEqual(edited);
    expect(migrated.questions.find(q => q.id === editedOriginal.id)).toEqual(editedOriginal);
    expect(migrated.questions).toHaveLength(24);
    expect(migrated.version).toBe(27);
    expect(migrated.roles[0].questionIds).toEqual([...sharedResumeQuestions.map(q => q.id), 'personal_task', custom.id]);
    expect(migrated.run).toEqual(completed.run);
    expect(migrated.candidates).toEqual(completed.candidates);
    expect(await readResults(w.candidates[0].id)).toEqual(results);
    await saveRole({ ...migrated.roles[0], questionIds: [custom.id] }, migrated.roles[0]);
    await updateWorkspace(w => { w.candidates[0].bookmarked = true; });
    const persisted = await readWorkspace();
    expect(persisted.questionSelectionVersion).toBe(1);
    expect(persisted.roles[0].questionIds).toEqual([custom.id]);
    expect(await readResults(w.candidates[0].id)).toEqual(results);
  });
});
