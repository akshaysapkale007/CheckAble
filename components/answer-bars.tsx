'use client';
import { Loader2, Search } from 'lucide-react';
import type { Candidate, Evidence, Question, StoredAnswer } from '@/lib/schema';
import '@/app/answer-details.css';

const percent = (p: number | undefined) => p !== undefined && Number.isFinite(p) ? `${Number((p * 100).toFixed(1))}%` : 'Unavailable';
const width = (p: number | undefined) => `${p !== undefined && Number.isFinite(p) ? Math.max(0, Math.min(1, p)) * 100 : 0}%`;
const humanize = (id: string) => id.replaceAll('_', ' ');
const timestamp = (value: string) => Number.isFinite(Date.parse(value)) ? `${new Date(value).toISOString().replace('T', ' ').slice(0, 19)} UTC` : value;

export function AnswerBar({ question, stored, evidence, candidate, busy, onEvidence, missing = 'Not assessed' }: {
  question: Question; stored?: StoredAnswer; evidence?: Evidence; candidate?: Candidate;
  busy?: boolean; onEvidence?: () => void; missing?: string;
}) {
  const q = stored?.question ?? question;
  const a = stored?.answer;
  const fill = !a ? undefined : a.type === 'noul' ? a.noul : a.type === 'score' ? q.levels.length > 1 ? a.score / (q.levels.length - 1) : undefined : a.probabilities[a.choice];
  const result = !a ? missing : a.type === 'noul' ? `${percent(a.noul)} Yes` : a.type === 'score' ? `${Number(a.score.toFixed(2))} / ${q.levels.length - 1}` : humanize(a.choice);
  const definitionRows = q.primitive === 'score'
    ? q.levels.map((description, i) => ({ id: String(i), label: `Level ${i}`, description, p: a?.type === 'score' ? a.probabilities[String(i)] : undefined }))
    : q.primitive === 'choice'
      ? q.options.map(o => ({ id: o.id, label: humanize(o.id), description: o.description, p: a?.type === 'choice' ? a.probabilities[o.id] : undefined }))
      : [{ id: 'yes', label: 'Yes', description: 'The condition in the question is supported.', p: a?.type === 'noul' ? a.noul : undefined }, { id: 'no', label: 'No', description: 'The condition in the question is not supported.', p: a?.type === 'noul' ? 1 - a.noul : undefined }];
  const savedEvidence = stored && evidence?.answerKey === stored.key ? evidence : undefined;
  const passage = savedEvidence?.selectedId ? candidate?.paragraphs.find(p => p.id === savedEvidence.selectedId && candidate.text.includes(p.text)) : undefined;
  const passageSelection = savedEvidence?.native.answers.where;
  const writingDiagnostic = q.group === 'Writing diagnostics';

  return <details className={`answer-bar ${a ? 'has-answer' : 'unanswered'}`}>
    <summary aria-label={`${q.title}: ${result}`}>
      <span className="bar-label">{q.title}</span>
      <span className="bar-track" aria-hidden="true">{fill !== undefined && <span style={{ width: width(fill) }} />}</span>
      <span className="bar-result" title={result}>{a?.type === 'choice' && <small>{percent(a.probabilities[a.choice])}</small>}{result}</span>
    </summary>
    <div className="bar-detail">
      <div className="bar-detail-heading"><code>{q.id}</code><span>{q.primitive === 'noul' ? 'Noul · yes / no' : q.primitive === 'score' ? `Score · ${q.levels.length} levels · 0–${q.levels.length - 1}` : `Choice · ${q.options.length} options`}</span></div>
      <div className="answer-tags"><span>{q.scope === 'general' ? 'General · reusable across roles' : 'Role-specific'}</span><span>{stored ? 'Saved definition' : 'Question definition'} · v{q.version}</span>{(q.experimental || writingDiagnostic) && <span className="experimental-tag">Experimental{writingDiagnostic ? ' writing diagnostic' : ''}</span>}</div>
      <p className="answer-instructions">{q.instructions.replaceAll('{{today}}', 'the evaluation date')}</p>
      {writingDiagnostic && <p className="answer-footnote">Describes the resume text. It does not determine authorship, honesty, personality, or candidate rank.</p>}

      <div className="answer-rubric-heading"><strong>{q.primitive === 'score' ? 'Full rubric' : q.primitive === 'choice' ? 'Answer options' : 'Possible answers'}</strong><span>{a ? 'Native probabilities' : 'Ready to assess'}</span></div>
      <div className={`answer-definition ${a ? 'with-probabilities' : ''}`}>{definitionRows.map(row => <div className="answer-definition-row" key={row.id}>
        <div><strong>{row.label}{a?.type === 'choice' && a.choice === row.id && <span className="selected-option">Selected</span>}</strong><p>{row.description}</p></div>
        {a && <div className="answer-probability" title={row.p === undefined ? 'No saved probability' : `Native probability: ${row.p}`}><span className="bar-track" aria-hidden="true"><span style={{ width: width(row.p) }} /></span><b>{percent(row.p)}</b></div>}
      </div>)}</div>

      {a?.type === 'score' && <p className="answer-footnote">Native score: {a.score} on the 0–{q.levels.length - 1} rubric. The bar shows its position on those levels. Confidence: {percent(a.confidence)}.</p>}
      {a?.type === 'choice' && <p className="answer-footnote">Selected option: {humanize(a.choice)}. Confidence: {percent(a.confidence)}.</p>}
      {a && a.type !== 'noul' && <p className="answer-footnote">Confidence describes how concentrated the answer probabilities are. It does not verify the resume or affect ranking.</p>}
      {q.primitive === 'noul' && <p className="answer-footnote">{a?.type === 'noul' ? `Native P(yes): ${a.noul}. ` : ''}The bar shows probability of yes; there is no separate confidence. Near 50% means uncertainty between yes and no.</p>}
      {!a && <p className="answer-footnote">{missing}. No current answer or probabilities are available for this assessment.</p>}

      {stored && <dl className="answer-provenance"><div><dt>Model</dt><dd>{stored.model}</dd></div><div><dt>Evaluated</dt><dd><time dateTime={stored.createdAt}>{timestamp(stored.createdAt)}</time></dd></div>{q.scope === 'role' && <div><dt>Role snapshot</dt><dd>{stored.roleId ?? 'Unavailable'} · revision {stored.roleRevision ?? 'unavailable'}</dd></div>}</dl>}

      {stored && (onEvidence || evidence) && <div className="bar-evidence">
        {onEvidence && <button className="text-button" disabled={busy} onClick={onEvidence}>{busy ? <Loader2 size={13} className="spin" /> : <Search size={13} />}{busy ? 'Finding passage…' : savedEvidence ? 'Refresh supporting passage' : 'Find supporting passage'}</button>}
        {savedEvidence ? <>
          <p className="answer-footnote">Probability that a supplied passage supports this answer: {percent(savedEvidence.exists)}.</p>
          {savedEvidence.selectedId ? passage ? <><p className="answer-evidence-label">Original passage · {passage.id}</p><blockquote>{passage.text}</blockquote></> : <p>The selected original passage is unavailable in this resume.</p> : <p>No supporting passage selected.</p>}
          <p className="answer-footnote">A selected passage is evidence to inspect, not verified work history or a generated explanation.</p>
          {passageSelection?.type === 'choice' && <details className="answer-passage-choices"><summary>Passage selection probabilities</summary>
            <div className="answer-passage-options">{Object.entries(passageSelection.probabilities).map(([id, p]) => <div key={id}><span>{id === 'no_support' ? 'No supporting passage' : id}{passageSelection.choice === id ? ' · selected' : ''}</span><b title={`Native probability: ${p}`}>{percent(p)}</b></div>)}</div>
            <p className="answer-footnote">Passage selection confidence: {percent(passageSelection.confidence)}. Probabilities compare the passages supplied to the saved selection step.</p>
          </details>}
          <p className="answer-footnote">Evidence model: {savedEvidence.model} · retrieved <time dateTime={savedEvidence.retrievedAt}>{timestamp(savedEvidence.retrievedAt)}</time>.</p>
        </> : evidence ? <p className="answer-footnote">Saved evidence belongs to a different answer and is not shown as support for this one.</p> : <p className="answer-footnote">Find evidence to ask Jev to select a passage from the original resume. This makes a separate assessment request.</p>}
      </div>}
      <details className="raw-answer"><summary>{stored ? 'Saved definition & native answer' : 'Full question definition'}</summary><pre>{JSON.stringify({ question: q, ...(stored ? { answer: a, model: stored.model, evaluatedAt: stored.createdAt, roleId: stored.roleId, roleRevision: stored.roleRevision, stateHash: stored.stateHash } : {}), ...(savedEvidence ? { evidence: savedEvidence } : {}) }, null, 2)}</pre></details>
    </div>
  </details>;
}
