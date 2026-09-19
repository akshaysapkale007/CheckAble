'use client';
import { Pencil } from 'lucide-react';
import type { Question } from '@/lib/schema';
import { initialQuestions } from '@/lib/registry';
import { sharedQuestionIds } from '@/lib/shared-questions';

const groups = ['Shared resume profile', 'Work performed', 'Experience detail', 'Writing diagnostics', 'Role questions'];
const originalIds = new Set(initialQuestions.map(q => q.id));

export function questionGroups(questions: Question[]) {
  return groups.map(name => ({ name, questions: questions.filter(q => (sharedQuestionIds.has(q.id) ? 'Shared resume profile' : q.group) === name) })).filter(group => group.questions.length);
}

export function QuestionLibrary({ questions, selectedIds, disabled, onSelect, onEdit }: {
  questions: Question[]; selectedIds: string[]; disabled: boolean;
  onSelect: (ids: string[]) => void; onEdit: (question: Question) => void;
}) {
  function toggle(ids: string[], selected: boolean) {
    onSelect(selected ? [...new Set([...selectedIds, ...ids])] : selectedIds.filter(id => !ids.includes(id)));
  }
  return <div className="full-question-library">
    {questionGroups(questions).map(group => {
      const selectable = group.questions.filter(q => q.id !== 'assessability');
      const selected = selectable.filter(q => selectedIds.includes(q.id)).length;
      return <section className="library-question-group" key={group.name}>
        <div className="library-group-heading"><h3>{group.name}</h3><span>{selected} / {selectable.length} selected</span>{selectable.length > 0 && <button className="text-button" disabled={disabled} onClick={() => toggle(selectable.map(q => q.id), selected !== selectable.length)}>{selected === selectable.length ? 'Clear group' : 'Select group'}</button>}</div>
        {group.name === 'Writing diagnostics' && <p className="library-group-note">Text diagnostics only. These answers never contribute to role relevance or ranking.</p>}
        {group.questions.map(q => <div className="library-question" key={q.id}>
          <label className="library-question-select"><input type="checkbox" disabled={disabled || q.id === 'assessability'} checked={q.id === 'assessability' || selectedIds.includes(q.id)} onChange={event => toggle([q.id], event.target.checked)} /><span>{q.title}</span></label>
          <div className="library-question-meta"><span>{q.id === 'assessability' ? 'Always assessed' : sharedQuestionIds.has(q.id) ? 'Shared profile' : originalIds.has(q.id) ? 'Original library' : 'Custom question'}</span><span>{q.scope === 'general' ? 'Reusable across roles' : 'Role-specific'} · v{q.version}</span><button className="text-button" disabled={disabled} onClick={() => onEdit(q)} aria-label={`Edit ${q.title}`}><Pencil size={12} />Edit</button></div>
          <details className="library-question-definition"><summary>Question & answer definition</summary><p>{q.instructions}</p>{q.primitive === 'score' ? <ol start={0}>{q.levels.map((level, i) => <li key={i}>{level}</li>)}</ol> : q.primitive === 'choice' ? <ul>{q.options.map(option => <li key={option.id}><strong>{option.id.replaceAll('_', ' ')}</strong> — {option.description}</li>)}</ul> : <p>Returns the probability of yes, from 0 to 1.</p>}</details>
        </div>)}
      </section>;
    })}
  </div>;
}
