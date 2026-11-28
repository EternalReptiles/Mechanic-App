import { db } from './db';
import type { Job, PurchaseOrder } from './types';
import { addMonthsISO } from './utils';

const DONE = ['completed', 'invoiced', 'paid'];

/**
 * When a job is finished, take its parts off the shelf (once). Returns the job patch to save, or null if nothing to do.
 */
export async function deductStockIfDone(job: Job): Promise<Partial<Job> | null> {
  if (job.stockDeducted || !DONE.includes(job.status)) return null;
  const lines = job.lineItems.filter((l) => l.stockId && l.qty > 0);
  if (!lines.length) return null;
  await db.transaction('rw', db.stock, async () => {
    for (const l of lines) {
      const item = await db.stock.get(l.stockId!);
      if (item) await db.stock.put({ ...item, onHand: Math.round((item.onHand - l.qty) * 100) / 100 });
    }
  });
  return { stockDeducted: true };
}

/** Is this a service (logbook/minor/major/km service), not just e.g. "service the brakes"? */
export const isServiceJob = (j: Pick<Job, 'title' | 'description' | 'workNotes'>) =>
  /\b(servic(e|ed|ing)|logbook)\b/i.test(`${j.title}\n${j.description}\n${j.workNotes}`)
  && !/\b(brakes?|aircon|air con|transmission|gearbox)\s+servic/i.test(j.title);

/**
 * When a service job is finished: the car's next service is due one service interval later
 * (e.g. 6 months / 10,000 km), so it shows in reminders and the automatic service reminder goes out.
 */
export async function setNextServiceIfDone(job: Job): Promise<Partial<Job> | null> {
  if (job.serviceDueSet || job.imported || !DONE.includes(job.status) || !job.vehicleId || !isServiceJob(job)) return null;
  const [vehicle, settings] = await Promise.all([db.vehicles.get(job.vehicleId), db.settings.get('settings')]);
  if (!vehicle) return null;
  const months = settings?.serviceIntervalMonths || 6;
  const kmStep = settings?.serviceIntervalKm || 10000;
  const from = new Date(job.finishedAt || job.paidAt || Date.now());
  const date = addMonthsISO(months, from);
  const km = Number(String(job.odometer || vehicle.odometer || '').replace(/\D/g, ''));
  // Don't pull an existing later date forward (e.g. one typed in by hand).
  if (!vehicle.nextServiceDate || vehicle.nextServiceDate < date) {
    await db.vehicles.put({ ...vehicle, nextServiceDate: date, nextServiceKm: km ? String(km + kmStep) : vehicle.nextServiceKm ?? '' });
  }
  return { serviceDueSet: true };
}

/**
 * A car with no next service date: work it out from its last finished service (one service interval later).
 * Leaves the date empty if the car has never had a service recorded.
 */
export async function fillServiceDueFromHistory(vehicleId: string): Promise<void> {
  const vehicle = await db.vehicles.get(vehicleId);
  if (!vehicle || vehicle.nextServiceDate) return;
  const done = (await db.jobs.where('vehicleId').equals(vehicleId).toArray()).filter((j) => DONE.includes(j.status) && isServiceJob(j));
  const when = (j: Job) => j.finishedAt || j.paidAt || j.invoicedAt || j.scheduledStart || j.createdAt || '';
  const last = done.sort((a, b) => when(b).localeCompare(when(a)))[0];
  if (!last || !when(last)) return;
  const settings = await db.settings.get('settings');
  const km = Number(String(last.odometer || '').replace(/\D/g, ''));
  await db.vehicles.update(vehicleId, {
    nextServiceDate: addMonthsISO(settings?.serviceIntervalMonths || 6, new Date(when(last))),
    ...(km && !vehicle.nextServiceKm ? { nextServiceKm: String(km + (settings?.serviceIntervalKm || 10000)) } : {}),
  });
}

/** Everything that happens once when a job is finished: stock comes off the shelf, the next service is booked in. */
export async function whenJobDone(job: Job): Promise<Partial<Job> | null> {
  const a = await deductStockIfDone(job);
  const b = await setNextServiceIfDone(job);
  return a || b ? { ...a, ...b } : null;
}

/** Booking in a delivery: adds the ordered quantities to stock (and updates cost prices). */
export async function receiveOrder(order: PurchaseOrder) {
  await db.transaction('rw', db.stock, db.orders, async () => {
    for (const l of order.lines) {
      if (!l.stockId) continue;
      const item = await db.stock.get(l.stockId);
      if (item) await db.stock.put({ ...item, onHand: Math.round((item.onHand + l.qty) * 100) / 100, cost: l.cost || item.cost });
    }
    await db.orders.put({ ...order, status: 'received', receivedAt: new Date().toISOString() });
  });
}

export async function nextOrderNumber() {
  const last = await db.orders.orderBy('number').last();
  return (last?.number ?? 0) + 1;
}
