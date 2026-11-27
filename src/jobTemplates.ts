import { stopAllPatch } from './time/timer';
import type { JobTask, JobTemplate, TaskTemplateItem } from './types';
import { uid } from './utils';

const i = (label: string, type: TaskTemplateItem['type'], more: Partial<TaskTemplateItem> = {}): TaskTemplateItem => ({
  id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  label,
  type,
  ...more,
});

/** Starter checklists – owners can edit these in Settings → Job checklists. */
export const DEFAULT_TEMPLATES: JobTemplate[] = [
  {
    id: 'logbook-service',
    name: 'Logbook service',
    items: [
      i('Odometer', 'number', { unit: 'km', required: true, mapsTo: 'odometer' }),
      i('Engine oil drained and refilled', 'check', { required: true }),
      i('Engine oil used', 'number', { unit: 'L', required: true, invoice: { description: 'Engine oil', unitPrice: 11 } }),
      i('Oil grade', 'choice', { options: ['0W-20', '5W-30', '5W-40', '10W-40', '15W-40'], required: true }),
      i('Oil filter replaced', 'yesno', { required: true }),
      i('Air filter', 'choice', { options: ['OK', 'Cleaned', 'Replaced'] }),
      i('Cabin filter', 'choice', { options: ['OK', 'Replaced', 'N/A'] }),
      i('Spark plugs', 'choice', { options: ['OK', 'Replaced', 'N/A (diesel)'] }),
      i('Coolant level checked / topped up', 'check'),
      i('Brake fluid', 'choice', { options: ['OK', 'Topped up', 'Due for replacement'] }),
      i('Front brake pads', 'number', { unit: 'mm' }),
      i('Rear brake pads', 'number', { unit: 'mm' }),
      i('Tyre pressures set', 'check'),
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

/** Copies a template onto a job as a fresh checklist. */
export function tasksFromTemplate(t: JobTemplate): JobTask[] {
  return t.items.map((it) => ({ ...it, id: `${it.id}-${uid().slice(0, 6)}`, value: it.type === 'check' ? false : null }));
}

export function isAnswered(t: JobTask): boolean {
  if (t.type === 'check') return t.value === true;
  return t.value !== null && t.value !== '' && t.value !== undefined;
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
