import { describe, expect, it } from 'vitest';
import { jobText, prepareDataset, resumeText } from '../lib/dataset';
import { parseImport } from '../lib/imports';
import { activeBrief, evaluationState } from '../lib/logic';
import { toCandidate } from '../lib/server/workspace';

function source() {
  return {
    djinni: [{ row_index: 7, row: { id: 'original-123', Position: 'Engineer', CV_lang: 'en', 'Primary Keyword': 'Python', CV: '  Original CV\r\n\r\nKeep punctuation, spaces & <script> as data.\n' } }],
    synthetic_resumes: [{ row_index: 2, row: { resume_id: 'R_000002', role: 'Backend Engineer', seniority: 'Mid', years_experience: 4, industry: 'SaaS', education: 'BSc', skills: ['Python', 'SQL'], summary: 'Summary with exact wording.', experience_bullets: ['Original first bullet.', 'Original second bullet.'] } }],
    synthetic_jobs: [{ row_index: 4, row: { job_id: 'J_000004', job_title: 'Backend Engineer', seniority: 'Mid', industry: 'SaaS', description: 'Original description.', must_have_skills: ['Python'], nice_to_have_skills: ['Docker'], responsibilities: ['Build APIs.'], requirements: ['Relevant experience.'] } }],
  };
}

describe('external dataset mapping (no live models)', () => {
  it('keeps Djinni CV characters exact and preserves synthetic identity without injecting labels into resume evidence', () => {
    const input = source();
    const { candidates } = prepareDataset(input);
    expect(candidates[0].text).toBe(input.djinni[0].row.CV);
    expect(toCandidate(candidates[0]).fictional).toBe(false);
    expect(toCandidate(candidates[1]).fictional).toBe(true);
    expect(candidates[1].text).not.toContain('Synthetic');
    expect(evaluationState(candidates[1].text, undefined)).toEqual({ resume: candidates[1].text });
    expect(parseImport(JSON.stringify(candidates), 'json')).toEqual(candidates);
  });

  it('formats every synthetic source field without generating additional work claims', () => {
    const input = source();
    expect(resumeText(input.synthetic_resumes[0].row)).toBe('Backend Engineer\n\nSeniority: Mid\nYears of experience: 4\nIndustry: SaaS\nEducation: BSc\n\nSkills\n- Python\n- SQL\n\nSummary\nSummary with exact wording.\n\nExperience\n- Original first bullet.\n- Original second bullet.');
    const jd = jobText(input.synthetic_jobs[0].row);
    for (const value of ['Backend Engineer', 'Mid', 'SaaS', 'Original description.', 'Python', 'Docker', 'Build APIs.', 'Relevant experience.']) expect(jd).toContain(value);
  });

  it('creates roles with no approved criteria or inherited source matching scores', () => {
    const { roles } = prepareDataset(source());
    expect(roles[0].criteria).toEqual([]);
    expect(roles[0].recruiterInstructions).toBe('');
    expect(roles[0].filter).toBeNull();
    expect(activeBrief(roles[0])).not.toContain('Python');
  });

  it('rejects invalid or duplicate records before constructing a usable pool', () => {
    const input = source();
    input.djinni[0].row.CV = '   ';
    expect(() => prepareDataset(input)).toThrow('empty');
    const duplicate = source();
    duplicate.djinni.push(structuredClone(duplicate.djinni[0]));
    expect(() => prepareDataset(duplicate)).toThrow('Duplicate');
    const unsafe = source();
    unsafe.synthetic_jobs[0].row.job_id = '../escape';
    expect(() => prepareDataset(unsafe)).toThrow();
  });

  it('retains short evidence and rejects non-boolean fictional metadata', () => {
    const input = source();
    input.djinni[0].row.CV = 'Analyst';
    expect(prepareDataset(input).candidates[0].text).toBe('Analyst');
    expect(() => parseImport('[{"id":"x","text":"CV","fictional":"true"}]', 'json')).toThrow();
    expect(toCandidate(parseImport('[{"id":"x","text":"FICTIONAL old fixture"}]', 'json')[0]).fictional).toBe(true);
  });
});
