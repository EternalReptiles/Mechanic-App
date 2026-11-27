import { db } from './db';
import type { Job, PurchaseOrder } from './types';

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
