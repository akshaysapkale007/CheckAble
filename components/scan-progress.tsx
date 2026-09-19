import '@/app/scan-progress.css';

export type ScanProgressProps = {
  items: Array<{id: string; status: 'pending' | 'running' | 'complete' | 'failed'}>;
  status: 'idle' | 'running' | 'paused' | 'complete';
  processed: number;
  total: number;
  failed: number;
  elapsedMs: number;
  model?: string;
  cacheHits: number;
};

const labels = {idle: 'Ready to scan', running: 'Scanning', paused: 'Paused', complete: 'Scan complete'};
const number = (value: number) => value.toLocaleString();

export function ScanProgress({items, status, processed, total, failed, elapsedMs, model, cacheHits}: ScanProgressProps) {
  const complete = Math.max(0, processed - failed);
  const active = items.filter(item => item.status === 'running').length;
  const pending = Math.max(0, total - processed - active);
  const progress = total ? Math.min(100, processed / total * 100) : 0;
  const visible = items.slice(0, 1000);
  const seconds = Math.round(elapsedMs / 1000);
  const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

  return <section className="scan-overview" aria-label="Resume scan progress">
    <div className="scan-heading">
      <div className="scan-title"><h2>Resume coverage<span> · {number(total)} resumes</span></h2><p>One square, one resume. Coverage reflects the saved question selection; earlier answers stay saved.</p></div>
      <div className="scan-summary"><span className={`scan-state scan-state-${status}`}><i/>{labels[status]}</span><strong>{number(processed)}<span> / {number(total)}</span></strong></div>
    </div>
    {visible.length ? <div className="scan-mosaic" role="img" aria-label={`${number(total)} resumes: ${number(complete)} saved, ${number(active)} scanning, ${number(pending)} pending, ${number(failed)} failed.`}>
      {visible.map(item => <span key={item.id} className={`scan-cell scan-cell-${item.status}`} title={`${item.id} · ${item.status === 'complete' ? 'answers saved' : item.status}`} aria-hidden="true"/>)}
    </div> : <div className="scan-empty">{total?'Loading saved scan progress…':'Import resumes to see your scan take shape.'}</div>}
    <div className="scan-progress-line" role="progressbar" aria-label="Resumes processed" aria-valuemin={0} aria-valuemax={Math.max(total, 1)} aria-valuenow={processed} aria-valuetext={`${number(processed)} of ${number(total)} processed`}><span style={{width: `${progress}%`}}/></div>
    <div className="scan-footer">
      <div className="scan-legend"><span><i className="scan-cell-complete"/>{number(complete)} saved</span><span><i className="scan-cell-running"/>{number(active)} scanning</span><span><i className="scan-cell-pending"/>{number(pending)} pending</span>{failed > 0 && <span><i className="scan-cell-failed"/>{number(failed)} failed</span>}</div>
      <div className="scan-meta">{visible.length < items.length && <span>First 1,000 shown</span>}{elapsedMs > 0 && <span>{elapsed} elapsed</span>}{cacheHits > 0 && <span>{number(cacheHits)} answers reused</span>}{model && <span>{model}</span>}</div>
    </div>
  </section>;
}
