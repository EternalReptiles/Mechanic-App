import { stopAllPatch } from './time/timer';
import type { JobTask, JobTemplate, TaskTemplateItem } from './types';
import { uid } from './utils';

const i = (label: string, type: TaskTemplateItem['type'], more: Partial<TaskTemplateItem> = {}): TaskTemplateItem => ({
  id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  label,
  type,
  ...more,
});

/** Engine oil grades for the oil grade picker (anything else can be typed in). */
export const OIL_GRADES = ['0W-8', '0W-16', '0W-20', '0W-30', '0W-40', '5W-20', '5W-30', '5W-40', '5W-50', '10W-30', '10W-40', '10W-60', '15W-40', '15W-50', '20W-50', '25W-60'];
export const isOilGrade = (label: string) => /oil grade|oil type|viscosity/i.test(label);

/** Starter checklists – owners can edit these in Settings → Job checklists. */
export const DEFAULT_TEMPLATES: JobTemplate[] = [
  {
    id: 'logbook-service',
    name: 'Logbook service',
    items: [
      i('Odometer', 'number', { unit: 'km', required: true, mapsTo: 'odometer' }),
      i('Engine oil drained and refilled', 'check', { required: true }),
      i('Engine oil used', 'number', { unit: 'L', required: true, invoice: { description: 'Engine oil', unitPrice: 11 } }),
      i('Oil grade', 'choice', { options: OIL_GRADES, required: true }),
      i('Oil filter replaced', 'yesno', { required: true }),
      i('Air filter', 'choice', { options: ['Replaced', 'Cleaned', 'Not due'] }),
      i('Cabin filter', 'choice', { options: ['OK', 'Replaced', 'N/A'] }),
      i('Spark plugs', 'choice', { options: ['OK', 'Replaced', 'N/A (diesel)'] }),
      i('Service sticker updated', 'check'),
      i('Road test completed', 'check', { required: true }),
    ],
  },
  {
    id: 'brake-job',
    name: 'Brake job',
    items: [
      i('Odometer', 'number', { unit: 'km', mapsTo: 'odometer' }),
      i('Front pads', 'choice', { options: ['Replaced', 'OK', 'N/A'], required: true }),
      i('Rear pads / shoes', 'choice', { options: ['Replaced', 'OK', 'N/A'], required: true }),
      i('Front rotor thickness', 'number', { unit: 'mm' }),
      i('Rear rotor thickness', 'number', { unit: 'mm' }),
      i('Rotors', 'choice', { options: ['Within spec', 'Machined', 'Replaced'] }),
      i('Brake fluid used', 'number', { unit: 'L', invoice: { description: 'Brake fluid', unitPrice: 18 } }),
      i('Calipers and slide pins checked', 'check'),
      i('Road test completed', 'check', { required: true }),
    ],
  },
];

export function templatesFor(saved?: JobTemplate[]): JobTemplate[] {
  return saved && saved.length ? saved : DEFAULT_TEMPLATES;
}

/** Copies a template onto a job as a fresh checklist (the odometer comes across if it's already been entered). */
export function tasksFromTemplate(t: JobTemplate, odometer = '', previous: JobTask[] = []): JobTask[] {
  const km = Number(String(odometer).replace(/\D/g, '')) || null;
  return t.items.map((it) => {
    const base: JobTask = { ...it, id: `${it.id}-${uid().slice(0, 6)}`, value: it.type === 'check' ? false : it.mapsTo === 'odometer' ? km : null };
    // The same car last time: its oil grade is filled in (check it), litres etc. are shown as a hint.
    const prev = previous.find((p) => p.label === it.label && p.value !== null && p.value !== '' && p.value !== undefined);
    if (!prev || it.mapsTo || it.type === 'check' || it.type === 'yesno') return base;
    if (it.type === 'choice' && isOilGrade(it.label)) return { ...base, value: prev.value, last: String(prev.value) };
    return { ...base, last: String(prev.value) };
  });
}

/** The checklist from this car's most recent other job, so its oil grade and litres can be reused. */
export async function previousTasks(vehicleId: string, notJobId: string): Promise<JobTask[]> {
  if (!vehicleId) return [];
  const { db } = await import('./db');
  const jobs = (await db.jobs.where('vehicleId').equals(vehicleId).toArray())
    .filter((j) => j.id !== notJobId && j.tasks?.length)
    .sort((a, b) => (b.finishedAt || b.createdAt || '').localeCompare(a.finishedAt || a.createdAt || ''));
  return jobs[0]?.tasks ?? [];
}

/** The odometer is one reading: typing it on Details fills the checklist, and the other way round. */
export function tasksWithOdometer(tasks: JobTask[] | undefined, odometer: string): JobTask[] | undefined {
  if (!tasks?.some((t) => t.mapsTo === 'odometer')) return tasks;
  const km = Number(String(odometer).replace(/\D/g, '')) || null;
  return tasks.map((t) => (t.mapsTo === 'odometer' ? { ...t, value: km } : t));
}
export function odometerFromTasks(before: JobTask[] | undefined, after: JobTask[]): string | null {
  const a = after.find((t) => t.mapsTo === 'odometer');
  const b = before?.find((t) => t.mapsTo === 'odometer');
  if (!a || a.value === b?.value) return null;
  return a.value === null || a.value === undefined ? '' : String(a.value);
}

export function isAnswered(t: JobTask): boolean {
  if (t.type === 'check') return t.value === true;
  if (typeof t.value === 'string') return t.value.trim() !== '';
  return t.value !== null && t.value !== undefined;
}

export function missingRequired(tasks: JobTask[] = []): JobTask[] {
  return tasks.filter((t) => t.required && !isAnswered(t));
}

export function displayValue(t: JobTask): string {
  if (t.type === 'check') return t.value ? 'Done' : '—';
  if (t.type === 'yesno') return t.value === true ? 'Yes' : t.value === false ? 'No' : '—';
  if (t.value === null || t.value === '' || t.value === undefined) return '—';
  return `${t.value}${t.unit ? ' ' + t.unit : ''}`;
}

/**
 * What finishing a job changes: status → completed, who/when, the odometer reading,
 * and invoice lines for measured amounts (e.g. 4.5 L of oil) – added once.
 */
export function finishJobPatch(
  job: { lineItems: import('./types').LineItem[]; tasks?: JobTask[]; taskLinesAdded?: boolean; odometer: string; status: string; timeEntries?: import('./types').TimeEntry[] },
  userId: string,
): { patch: Partial<import('./types').Job>; odometer?: string } {
  const tasks = job.tasks ?? [];
  const odo = tasks.find((t) => t.mapsTo === 'odometer' && isAnswered(t));
  const lines = job.taskLinesAdded
    ? []
    : tasks
        .filter((t) => t.type === 'number' && t.invoice && typeof t.value === 'number' && t.value > 0)
        // Don't double-charge: skip if the job already has a line for it (e.g. oil in a service package).
        .filter((t) => !job.lineItems.some((l) => l.description.toLowerCase().includes(t.invoice!.description.toLowerCase())))
        .map((t) => ({
          id: uid(),
          type: 'part' as const,
          description: `${t.invoice!.description}${t.unit ? ` (${t.unit})` : ''}`,
          qty: t.value as number,
          unitPrice: t.invoice!.unitPrice,
          repair: 'Service items',
        }));
  const now = new Date().toISOString();
  return {
    patch: {
      status: ['quote', 'scheduled', 'in_progress', 'waiting'].includes(job.status) ? 'completed' : (job.status as never),
      finishedAt: now,
      finishedBy: userId,
      ...stopAllPatch(job),
      taskLinesAdded: job.taskLinesAdded || lines.length > 0 || undefined,
      lineItems: lines.length ? [...job.lineItems, ...lines] : job.lineItems,
      ...(odo ? { odometer: String(odo.value) } : {}),
    },
    odometer: odo ? String(odo.value) : undefined,
  };
}
