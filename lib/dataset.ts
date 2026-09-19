import { z } from 'zod';
import { parseImport } from './imports';
import { initialQuestions, relevanceRubric } from './registry';
import { roleSchema } from './schema';

const text = z.string();
const strings = z.array(text);
const indexed = <T extends z.ZodType>(row: T) => z.object({ row_index: z.number().int().nonnegative(), row });
export const sourceDataSchema = z.object({
  djinni: z.array(indexed(z.object({ id: text, CV: text, CV_lang: z.literal('en'), Position: text, 'Primary Keyword': text }))),
  synthetic_resumes: z.array(indexed(z.object({
    resume_id: text, role: text, seniority: text, years_experience: z.number().nonnegative(), industry: text,
    education: text, skills: strings, summary: text, experience_bullets: strings,
  }))),
  synthetic_jobs: z.array(indexed(z.object({
    job_id: text, job_title: text, seniority: text, industry: text, description: text,
    must_have_skills: strings, nice_to_have_skills: strings, responsibilities: strings, requirements: strings,
  }))),
});
export type SourceData = z.infer<typeof sourceDataSchema>;
const section = (title: string, values: string[]) => `${title}\n${values.map(value => `- ${value}`).join('\n')}`;

export function resumeText(row: SourceData['synthetic_resumes'][number]['row']) {
  return [row.role, `Seniority: ${row.seniority}\nYears of experience: ${row.years_experience}\nIndustry: ${row.industry}\nEducation: ${row.education}`,
    section('Skills', row.skills), `Summary\n${row.summary}`, section('Experience', row.experience_bullets)].join('\n\n');
}

export function jobText(row: SourceData['synthetic_jobs'][number]['row']) {
  return [row.job_title, `Seniority: ${row.seniority}\nIndustry: ${row.industry}`, row.description,
    section('Must-have skills', row.must_have_skills), section('Nice-to-have skills', row.nice_to_have_skills),
    section('Responsibilities', row.responsibilities), section('Requirements', row.requirements)].join('\n\n');
}

export function prepareDataset(input: unknown) {
  const source = sourceDataSchema.parse(input);
  const real = source.djinni.map(({ row }) => ({ id: `djinni_${row.id}`, name: `Djinni · ${row.Position}`, text: row.CV, fictional: false }));
  const synthetic = source.synthetic_resumes.map(({ row }) => ({
    id: `synthetic_${row.resume_id}`, name: `Synthetic · ${row.role} · ${row.seniority} · ${row.resume_id}`, text: resumeText(row), fictional: true,
  }));
  // Alternate sources in the export; the app still sorts by native Jev score, then ID.
  const mixed = real.flatMap((row, index) => synthetic[index] ? [row, synthetic[index]] : [row]);
  mixed.push(...synthetic.slice(real.length));
  const candidates = parseImport(JSON.stringify(mixed), 'json');
  if (new Set(candidates.map(row => row.text)).size !== candidates.length) throw new Error('Duplicate resume text in the prepared pool.');
  const roles = source.synthetic_jobs.map(({ row }) => roleSchema.parse({
    id: `synthetic_${row.job_id}`, name: `${row.seniority} ${row.job_title} · ${row.industry}`, jd: jobText(row),
    recruiterInstructions: '', revision: 1, criteria: [], rubric: [...relevanceRubric],
    questionIds: initialQuestions.filter(question => question.scope === 'general' && question.group !== 'Writing diagnostics').map(question => question.id),
    filter: null,
  }));
  if (new Set(roles.map(role => role.id)).size !== roles.length) throw new Error('Duplicate job IDs.');
  return { candidates, roles, source };
}
