import Dexie, { type DBCore, type DBCoreMutateRequest, type Table } from 'dexie';
import type { CatalogItem, Customer, Job, Photo, PurchaseOrder, Settings, StockItem, Vehicle } from './types';
import { uid } from './utils';

class MechanicDB extends Dexie {
  customers!: Table<Customer, string>;
  vehicles!: Table<Vehicle, string>;
  jobs!: Table<Job, string>;
  photos!: Table<Photo, string>;
  settings!: Table<Settings, string>;
  catalog!: Table<CatalogItem, string>;
  stock!: Table<StockItem, string>;
  orders!: Table<PurchaseOrder, string>;
  tombstones!: Table<Tombstone, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('mechanic-app');
    this.version(1).stores({
      customers: 'id, name',
      vehicles: 'id, customerId, rego',
      jobs: 'id, number, customerId, vehicleId, status, scheduledStart',
      photos: 'id, jobId',
      settings: 'id',
    });
    this.version(2)
      .stores({ catalog: 'id, name' })
      .upgrade((tx) => tx.table('catalog').bulkAdd(starterCatalog()));
    this.version(3).stores({
      customers: 'id, name, _dirty',
      vehicles: 'id, customerId, rego, _dirty',
      jobs: 'id, number, customerId, vehicleId, status, scheduledStart, _dirty',
      photos: 'id, jobId, _dirty',
      settings: 'id, _dirty',
      catalog: 'id, name, _dirty',
      tombstones: 'key',
      meta: 'key',
    });
    this.version(4).stores({ stock: 'id, name, partNumber, _dirty', orders: 'id, number, status, _dirty' });
    this.on('populate', (tx) => {
      tx.table('catalog').bulkAdd(starterCatalog());
    });
  }
}

// ---------- Change tracking for cloud sync ----------

/** Tables whose records sync to the cloud. */
export const SYNCED_TABLES = ['customers', 'vehicles', 'jobs', 'catalog', 'settings', 'photos', 'stock', 'orders'] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

export interface Tombstone {
  key: string;
  table: SyncedTable;
  id: string;
  at: number;
}

/** Called after every local (user) change, so the sync engine can push it. */
export const changeListener = { onLocalChange: () => {} };

/**
 * Difference between this device's clock and the server's (ms). Changes are stamped in server time, so a
 * computer or phone with the wrong date can't lose edits ("last change wins" needs everyone on the same clock).
 */
export const clock = {
  offset: (() => {
    try { return Number(localStorage.getItem('spannr-clock-offset')) || 0; } catch { return 0; }
  })(),
  set(ms: number) {
    this.offset = ms;
    try { localStorage.setItem('spannr-clock-offset', String(Math.round(ms))); } catch { /* private mode */ }
  },
};
export const serverNow = () => Date.now() + clock.offset;

/**
 * Stamps every record the app writes with `updatedAt` and marks it `_dirty` so it gets pushed.
 * Records written by the sync engine carry `_remote: 1` and are stored as-is.
 */
function trackingMiddleware(down: DBCore): DBCore {
  return {
    ...down,
    table(name) {
      const table = down.table(name);
      if (!(SYNCED_TABLES as readonly string[]).includes(name)) return table;
      return {
        ...table,
        mutate(req: DBCoreMutateRequest) {
          if (req.type !== 'add' && req.type !== 'put') return table.mutate(req);
          const now = serverNow();
          let local = false;
          const values = req.values.map((v) => {
            if (v && v._remote) {
              const { _remote: _r, ...rest } = v;
              return rest;
            }
            local = true;
            return { ...v, updatedAt: now, _dirty: 1 };
          });
          const result = table.mutate({ ...req, values } as DBCoreMutateRequest);
          if (local) result.then(() => setTimeout(() => changeListener.onLocalChange(), 0));
          return result;
        },
      };
    },
  };
}

function starterCatalog(): CatalogItem[] {
  const item = (name: string, lines: CatalogItem['lines']): CatalogItem => ({ id: uid(), name, lines });
  return [
    item('Logbook service – 4 cyl', [
      { type: 'labour', description: 'Logbook service labour', qty: 1.5, unitPrice: 120 },
      { type: 'part', description: 'Engine oil 5W-30 (5L)', qty: 1, unitPrice: 55 },
      { type: 'part', description: 'Oil filter', qty: 1, unitPrice: 18 },
      { type: 'part', description: 'Sump plug washer', qty: 1, unitPrice: 2 },
    ]),
    item('Front brake pads – replace', [
      { type: 'labour', description: 'Replace front brake pads', qty: 1, unitPrice: 120 },
      { type: 'part', description: 'Front brake pads', qty: 1, unitPrice: 85 },
    ]),
    item('Battery – supply & fit', [
      { type: 'labour', description: 'Battery test, supply & fit', qty: 0.5, unitPrice: 120 },
      { type: 'part', description: 'Battery', qty: 1, unitPrice: 220 },
    ]),
    item('Call-out fee', [{ type: 'other', description: 'Mobile call-out fee', qty: 1, unitPrice: 50 }]),
    item('Diagnostic scan', [{ type: 'labour', description: 'Diagnostic scan & report', qty: 1, unitPrice: 120 }]),
  ];
}

export { DEFAULT_INSPECTION as DEFAULT_CHECKLIST } from './inspection';
import { DEFAULT_INSPECTION } from './inspection';

export const db = new MechanicDB();
db.use({ stack: 'dbcore', name: 'sync-tracking', create: trackingMiddleware });

/** Deletes records and leaves a tombstone so the deletion syncs to other devices. */
export async function removeRecords(table: SyncedTable, ids: string[]) {
  if (!ids.length) return;
  await db.transaction('rw', db.table(table), db.tombstones, async () => {
    await db.table(table).bulkDelete(ids);
    await db.tombstones.bulkPut(ids.map((id) => ({ key: `${table}:${id}`, table, id, at: serverNow() })));
  });
  changeListener.onLocalChange();
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}
export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}

/** Wipes everything stored on this device (used when signing out or switching business). */
export async function clearLocalData() {
  await db.transaction('rw', [...SYNCED_TABLES.map((t) => db.table(t)), db.tombstones, db.meta], async () => {
    await Promise.all([...SYNCED_TABLES.map((t) => db.table(t).clear()), db.tombstones.clear(), db.meta.clear()]);
  });
}

/** Marks every local record as changed, so it all uploads (used when a new business adopts this device's data). */
export async function markAllDirty() {
  for (const t of SYNCED_TABLES) {
    await db.table(t).toCollection().modify((r: Record<string, unknown>) => {
      r._dirty = 1;
    });
  }
}

/** Set by the cloud module: hands out a server-allocated job number, or null when offline. */
export const jobNumbers = { allocateRemote: async (): Promise<number | null> => null };

export const defaultSettings: Settings = {
  id: 'settings',
  businessName: 'My Mobile Mechanics',
  abn: '',
  phone: '',
  email: '',
  address: '',
  website: '',
  logo: '',
  bankName: '',
  bsb: '',
  accountNumber: '',
  accountName: '',
  labourRate: 120,
  gstRegistered: true,
  paymentTermsDays: 7,
  nextJobNumber: 1001,
  invoiceFooter: 'Thank you for your business!',
  quoteFooter: 'This quote is valid for 30 days.',
  checklistTemplate: DEFAULT_INSPECTION,
  serviceIntervalMonths: 6,
  serviceIntervalKm: 10000,
  reminderMessage:
    "Hi {name}, it's {business}. Your {vehicle} is due for a service on {date}. Reply to this message to book a time and we'll come to you.",
  businessType: 'mobile',
  terms: '', // filled from DEFAULT_TERMS below
  readyMessage: "Hi {name}, it's {business}. Your {vehicle} is ready to collect. Total {total}. See you soon!",
};

export const DEFAULT_TERMS = `Payment: The total is due within {days} days of the invoice date unless {business} agrees otherwise in writing. I agree to pay reasonable costs of recovering any overdue amount.
Approved work only: Only the work I have approved will be done. If more work is needed, {business} will contact me for approval first.
Customer-supplied parts: Parts I supply are fitted at my risk. {business} is not responsible for the quality, suitability or failure of parts I supply, or for damage or extra labour caused by them. Workmanship by {business} is still guaranteed.
Existing faults and declined work: {business} is not responsible for existing wear, faults or damage unrelated to the work performed, or for problems arising from recommended work I have declined.
Parts warranty: New parts supplied by {business} carry the manufacturer's warranty.
Your rights: Our goods and services come with guarantees that cannot be excluded under the Australian Consumer Law. Nothing in these terms limits those rights.`;
defaultSettings.terms = DEFAULT_TERMS;

export const WORKSHOP_TERMS_EXTRA = `
Collecting your vehicle: Please collect your vehicle within 2 business days of being told it's ready. Reasonable storage fees may apply after that.`;

export const WORKSHOP_REMINDER =
  "Hi {name}, it's {business}. Your {vehicle} is due for a service on {date}. Reply to this message to book it in.";

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('settings');
  return { ...defaultSettings, ...s };
}

export function newCustomer(partial: Partial<Customer> = {}): Customer {
  return {
    id: uid(),
    name: '',
    phone: '',
    email: '',
    address: '',
    notes: '',
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

export function newVehicle(customerId: string, partial: Partial<Vehicle> = {}): Vehicle {
  return {
    id: uid(),
    customerId,
    rego: '',
    make: '',
    model: '',
    year: '',
    vin: '',
    odometer: '',
    notes: '',
    ...partial,
  };
}

async function nextJobNumber(): Promise<number> {
  try {
    const n = await jobNumbers.allocateRemote();
    if (n) return n;
  } catch {
    // offline – fall back to a local number
  }
  const [settings, last] = await Promise.all([getSettings(), db.jobs.orderBy('number').last()]);
  return Math.max(settings.nextJobNumber, (last?.number ?? 0) + 1);
}

/** Creates and saves a new job, allocating the next job number. */
export async function createJob(partial: Partial<Job> = {}): Promise<Job> {
  const settings = await getSettings();
  const job: Job = {
    id: uid(),
    number: await nextJobNumber(),
    location: settings.businessType === 'workshop' ? 'workshop' : 'onsite',
    customerId: '',
    vehicleId: '',
    status: 'quote',
    title: '',
    description: '',
    siteAddress: '',
    scheduledStart: '',
    durationMins: 60,
    odometer: '',
    lineItems: [],
    workNotes: '',
    createdAt: new Date().toISOString(),
    invoicedAt: '',
    paidAt: '',
    ...partial,
  };
  await db.jobs.add(job);
  return job;
}

export async function deleteCustomer(id: string) {
  const jobIds = await db.jobs.where('customerId').equals(id).primaryKeys();
  const photoIds = await db.photos.where('jobId').anyOf(jobIds).primaryKeys();
  const vehicleIds = await db.vehicles.where('customerId').equals(id).primaryKeys();
  await removeRecords('photos', photoIds);
  await removeRecords('jobs', jobIds);
  await removeRecords('vehicles', vehicleIds);
  await removeRecords('customers', [id]);
}

export async function deleteJob(id: string) {
  await removeRecords('photos', await db.photos.where('jobId').equals(id).primaryKeys());
  await removeRecords('jobs', [id]);
}

// ---------- Backup ----------

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function exportBackup(): Promise<Blob> {
  const photos = await db.photos.toArray();
  const data = {
    app: 'mechanic-app',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: await db.settings.toArray(),
    catalog: await db.catalog.toArray(),
    stock: await db.stock.toArray(),
    orders: await db.orders.toArray(),
    customers: await db.customers.toArray(),
    vehicles: await db.vehicles.toArray(),
    jobs: await db.jobs.toArray(),
    photos: await Promise.all(
      photos.filter((p) => p.blob).map(async (p) => ({ ...p, blob: await blobToDataUrl(p.blob!) })),
    ),
  };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export async function importBackup(file: File) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'mechanic-app') throw new Error('This is not a Spannr backup file.');
  const photos: Photo[] = await Promise.all(
    (data.photos ?? []).map(async (p: Photo & { blob: string }) => ({
      ...p,
      blob: await (await fetch(p.blob)).blob(),
    })),
  );
  // Merge into existing data (records with the same id are replaced). Merging rather than wiping
  // means a restore can't silently delete records that other devices still have.
  await db.transaction('rw', [db.settings, db.customers, db.vehicles, db.jobs, db.photos, db.catalog, db.stock, db.orders], async () => {
    await db.settings.bulkPut(data.settings ?? []);
    await db.catalog.bulkPut(data.catalog ?? []);
    await db.stock.bulkPut(data.stock ?? []);
    await db.orders.bulkPut(data.orders ?? []);
    await db.customers.bulkPut(data.customers ?? []);
    await db.vehicles.bulkPut(data.vehicles ?? []);
    await db.jobs.bulkPut(data.jobs ?? []);
    await db.photos.bulkPut(photos);
  });
}
