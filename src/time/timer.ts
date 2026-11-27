import { db } from '../db';
import type { Job, TimeEntry } from '../types';
import { uid } from '../utils';

export const entryMs = (e: TimeEntry, now = Date.now()) => Math.max(0, (e.end ? Date.parse(e.end) : now) - Date.parse(e.start));
export const fmtDuration = (ms: number) => {
  const m = Math.round(ms / 60000);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
export const running = (job: Job, userId: string) => job.timeEntries?.find((e) => e.userId === userId && !e.end);

/** Stops this person's clock on any other job (you can only be on one job at a time). */
async function stopElsewhere(userId: string, exceptJobId: string) {
  const now = new Date().toISOString();
  const others = (await db.jobs.toArray()).filter((j) => j.id !== exceptJobId && j.timeEntries?.some((e) => e.userId === userId && !e.end));
  for (const j of others) {
    await db.jobs.put({ ...j, timeEntries: j.timeEntries!.map((e) => (e.userId === userId && !e.end ? { ...e, end: now } : e)) });
  }
}

/** Patch that clocks this person on to the job. */
export async function clockOnPatch(job: Job, userId: string): Promise<Partial<Job>> {
  await stopElsewhere(userId, job.id);
  if (running(job, userId)) return {};
  return { timeEntries: [...(job.timeEntries ?? []), { id: uid(), userId, start: new Date().toISOString() }] };
}

/** Patch that clocks this person off the job. */
export function clockOffPatch(job: Job, userId: string): Partial<Job> {
  if (!running(job, userId)) return {};
  const now = new Date().toISOString();
  return { timeEntries: (job.timeEntries ?? [])
    .map((e) => (e.userId === userId && !e.end ? { ...e, end: now } : e))
    // A tap on and straight off again isn't worth keeping.
    .filter((e) => entryMs(e) >= 60000 || e.userId !== userId || e.end !== now) };
}

/** Patch that stops every running clock on the job (job finished / on hold). */
export function stopAllPatch(job: { timeEntries?: TimeEntry[] }): { timeEntries?: TimeEntry[] } {
  if (!job.timeEntries?.some((e) => !e.end)) return {};
  const now = new Date().toISOString();
  return { timeEntries: job.timeEntries.map((e) => (e.end ? e : { ...e, end: now })) };
}

/** Total clocked hours on the job, rounded up to the nearest quarter hour. */
export const billableHours = (job: Job) => {
  const ms = (job.timeEntries ?? []).reduce((t, e) => t + entryMs(e), 0);
  return Math.ceil(ms / (15 * 60000)) / 4;
};
