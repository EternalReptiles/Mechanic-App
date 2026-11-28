import type { Job, Settings, Vehicle, WorkNoteTemplate } from './types';
import { addMonthsISO, fillTemplate, fmtDay } from './utils';

/** Starter "work done" wording – owners change these in Settings → Work done templates. */
export const DEFAULT_WORK_NOTES: WorkNoteTemplate[] = [
  {
    id: 'logbook',
    name: 'Logbook service',
    keywords: 'logbook, service',
    text: 'Carried out logbook service as per manufacturer specifications. Replaced engine oil and oil filter, checked all fluid levels, brakes, tyres, lights and suspension. Service book stamped.\nOdometer: {odometer} km. Next service due {nextServiceDate} or {nextServiceKm} km, whichever comes first.',
  },
  {
    id: 'brakes',
    name: 'Brakes',
    keywords: 'brake, brakes, pads, rotors',
    text: 'Replaced brake pads and machined/replaced rotors as required. Cleaned and lubricated slide pins, checked brake fluid level and road tested – brakes operating correctly.',
  },
  {
    id: 'battery',
    name: 'Battery',
    keywords: 'battery',
    text: 'Tested battery and charging system. Fitted new battery, checked terminals and charging voltage – all operating correctly.',
  },
];

export const workNotesFor = (s: Settings): WorkNoteTemplate[] => s.workNoteTemplates ?? DEFAULT_WORK_NOTES;

const words = (s: string) => s.toLowerCase().split(/[,\n]/).map((w) => w.trim()).filter(Boolean);

/** The template that fits this job best (its keywords or name appear in the job title / description), if any. */
export function bestWorkNote(job: Job, list: WorkNoteTemplate[]): WorkNoteTemplate | undefined {
  const hay = `${job.title} ${job.description} ${job.tasksTemplate ?? ''}`.toLowerCase();
  let best: WorkNoteTemplate | undefined;
  let score = 0;
  for (const t of list) {
    const keys = [...words(t.keywords ?? ''), t.name.toLowerCase()];
    const n = keys.filter((k) => k && hay.includes(k)).length;
    if (n > score) { best = t; score = n; }
  }
  return best;
}

/** Fills {odometer} {nextServiceDate} {nextServiceKm} {rego} {vehicle} for this job. */
export function fillWorkNote(t: WorkNoteTemplate, job: Job, vehicle: Vehicle | undefined, s: Settings): string {
  const km = Number(String(job.odometer || vehicle?.odometer || '').replace(/\D/g, ''));
  const nextDate = vehicle?.nextServiceDate && vehicle.nextServiceDate > new Date().toISOString().slice(0, 10)
    ? vehicle.nextServiceDate : addMonthsISO(s.serviceIntervalMonths || 6);
  const nextKm = km ? km + (s.serviceIntervalKm || 10000) : Number(vehicle?.nextServiceKm || 0);
  const text = fillTemplate(t.text, {
    odometer: km ? km.toLocaleString('en-AU') : '___',
    nextServiceDate: fmtDay(nextDate),
    nextServiceKm: nextKm ? nextKm.toLocaleString('en-AU') : '___',
    rego: vehicle?.rego ?? '',
    vehicle: [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || 'vehicle',
  });
  return text;
}

/** On finishing a job with no work notes yet: the matching template, filled in (or nothing). */
export function autoWorkNotes(job: Job, vehicle: Vehicle | undefined, s: Settings): Partial<Job> {
  if (job.workNotes.trim()) return {};
  const t = bestWorkNote(job, workNotesFor(s));
  return t ? { workNotes: fillWorkNote(t, job, vehicle, s) } : {};
}
