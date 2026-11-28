import { Link } from 'react-router-dom';
import type { Job, Settings, Vehicle } from '../types';
import { bestWorkNote, fillWorkNote, workNotesFor } from '../workNotes';

/** Buttons under "Work done" that drop in a saved message (best match for this job first). */
export default function WorkNotePicker({ job, vehicle, settings, update }: {
  job: Job; vehicle?: Vehicle; settings: Settings; update: (p: Partial<Job>) => void;
}) {
  const list = workNotesFor(settings);
  if (!list.length) return null;
  const best = bestWorkNote(job, list);
  const ordered = best ? [best, ...list.filter((t) => t.id !== best.id)] : list;
  const insert = (id: string) => {
    const t = list.find((x) => x.id === id)!;
    const text = fillWorkNote(t, job, vehicle, settings);
    update({ workNotes: job.workNotes.trim() ? `${job.workNotes.trimEnd()}\n${text}` : text });
  };
  return (
    <div className="chips wrap work-note-picker">
      <span className="small muted">Add:</span>
      {ordered.map((t) => (
        <button key={t.id} type="button" className={`chip${t.id === best?.id ? ' active' : ''}`} onClick={() => insert(t.id)}>
          {t.id === best?.id ? '★ ' : ''}{t.name}
        </button>
      ))}
      <Link className="small" to="/settings/work-notes">Edit</Link>
    </div>
  );
}
