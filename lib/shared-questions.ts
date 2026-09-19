import type { Question } from './schema';

const question = (id: string, title: string, instructions: string, primitive: Question['primitive'], levels: string[] = [], options: Question['options'] = []): Question => ({
  id, title, instructions, primitive, levels, options, version: 1,
  scope: 'general', group: 'Experience detail', experimental: false,
});

// One recruiter-requested set, shared by every resume and every role.
export const sharedResumeQuestions: Question[] = [
  question('years_of_experience', 'Professional experience',
    'How many years of professional experience does the candidate have, as of today? Today: {{today}}. Use the employment dates stated in the resume. Count overlapping periods only once. Do not infer years from age, education dates, or seniority titles.', 'score',
    ['None', '2 years', '4 years', '6 years', '8 years', '10+ years']),
  question('technical_depth', 'Technical depth',
    'Rate hands-on engineering depth using the experience and project bullets: what the candidate personally built, how complex it was, how much they owned. Ignore skills keyword lists, titles, and company names. Score the depth shown, not the years worked. When torn between two levels, pick the lower.', 'score', [
      'No roles or projects where they wrote code. Technical exposure is adjacent only: manual QA, IT support, PM, sales engineering.',
      'Coding appears only as coursework, bootcamp, or tutorial projects (to-do apps, clones). Nothing shipped to real users.',
      "Small scoped work inside someone else's design: bug fixes, minor features, CRUD screens. One language, one layer. Bullets list tasks, not problems solved. Also score here if you can't tell what they actually built.",
      'Owns features end to end in a live system: designs, builds, tests, and ships with little supervision. Works across two layers (e.g. API plus frontend). Mentions code review, testing, deploys, or on-call.',
      'Owns whole systems and makes architecture tradeoffs. Depth in two domains (e.g. backend plus infrastructure). Hard problems with numbers attached: performance, scaling, migrations, incidents. Often leads projects or mentors.',
      'Deep specialist with real breadth: maintainer of a widely used open-source project, systems internals (compilers, kernels, distributed systems, database engines), or org-wide architecture ownership at significant scale.',
    ]),
  question('mentorship_demonstrated', 'Mentoring experience', 'Does the resume demonstrate mentoring experience?', 'noul'),
  question('llm_experience', 'AI / LLM products', 'Does the candidate have experience developing LLM products? Yes means the candidate has built products or features powered by AI or Large Language Models. No means the resume does not show experience building AI products.', 'noul'),
  question('certifications_opensource', 'Open source experience', 'Does the candidate have open source experience?', 'noul'),
  question('career_progression', 'Career progression', 'What type of career progression is shown? Use the stated sequence of roles and responsibilities. Do not infer motives for job changes. Choose unclear when dates or progression are not sufficiently described.', 'choice', [], [
    { id: 'steady_growth', description: 'Increasing responsibility, scope, or ownership over the stated career.' },
    { id: 'job_hopping', description: 'Repeated short employment tenures across employers are explicitly shown. This label describes the timeline, not the reasons for changes or candidate quality.' },
    { id: 'lateral_moves', description: 'Moves across roles with broadly similar responsibility or scope.' },
    { id: 'unclear', description: 'Too little chronology or responsibility detail to identify progression.' },
  ]),
  question('primary_talent_profile', 'Primary talent profile', "Pick the best match for the candidate's talent profile. Judge from their experience holistically, not from job titles or a skills list alone. Weight the most recent roles heaviest. Select other when no listed engineering profile is supported.", 'choice', [], [
    { id: 'full_stack_engineer', description: 'Builds across frontend and backend product layers.' },
    { id: 'frontend_engineer', description: 'Primarily builds user interfaces and frontend systems.' },
    { id: 'security_engineer', description: 'Primarily builds or operates security systems and controls.' },
    { id: 'other', description: 'Another profile, or insufficient evidence for a listed engineering profile.' },
    { id: 'embedded_systems', description: 'Primarily builds embedded software, firmware, or hardware-integrated systems.' },
    { id: 'mobile_engineer', description: 'Primarily builds mobile applications.' },
    { id: 'ml_ai_engineer', description: 'Primarily builds machine learning or AI systems and products.' },
    { id: 'data_engineer', description: 'Primarily builds data pipelines, platforms, or processing systems.' },
    { id: 'devops_infrastructure', description: 'Primarily builds or operates infrastructure, deployment, and reliability systems.' },
    { id: 'backend_engineer', description: 'Primarily builds server-side services, APIs, and backend systems.' },
  ]),
];
export const sharedQuestionIds = new Set(sharedResumeQuestions.map(q => q.id));
export const assessmentDate = () => new Date().toISOString().slice(0, 10);
