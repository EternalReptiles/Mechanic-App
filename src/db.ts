import Dexie, { type Table } from 'dexie';
import type { Customer, Job, Photo, Settings, Vehicle } from './types';
import { uid } from './utils';

class MechanicDB extends Dexie {
  customers!: Table<Customer, string>;
  vehicles!: Table<Vehicle, string>;
  jobs!: Table<Job, string>;
  photos!: Table<Photo, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super('mechanic-app');
    this.version(1).stores({
      customers: 'id, name',
      vehicles: 'id, customerId, rego',
      jobs: 'id, number, customerId, vehicleId, status, scheduledStart',
      photos: 'id, jobId',
      settings: 'id',
    });
  }
}

export const db = new MechanicDB();

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
};

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

/** Creates and saves a new job, allocating the next job number. */
export async function createJob(partial: Partial<Job> = {}): Promise<Job> {
  return db.transaction('rw', db.jobs, db.settings, async () => {
    const settings = await getSettings();
    const job: Job = {
      id: uid(),
      number: settings.nextJobNumber,
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
    await db.settings.put({ ...settings, nextJobNumber: settings.nextJobNumber + 1 });
    await db.jobs.add(job);
    return job;
  });
}

export async function deleteCustomer(id: string) {
  await db.transaction('rw', [db.customers, db.vehicles, db.jobs, db.photos], async () => {
    const jobIds = await db.jobs.where('customerId').equals(id).primaryKeys();
    await db.photos.where('jobId').anyOf(jobIds).delete();
    await db.jobs.bulkDelete(jobIds);
    await db.vehicles.where('customerId').equals(id).delete();
    await db.customers.delete(id);
  });
}

export async function deleteJob(id: string) {
  await db.transaction('rw', db.jobs, db.photos, async () => {
    await db.photos.where('jobId').equals(id).delete();
    await db.jobs.delete(id);
  });
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
    customers: await db.customers.toArray(),
    vehicles: await db.vehicles.toArray(),
    jobs: await db.jobs.toArray(),
    photos: await Promise.all(
      photos.map(async (p) => ({ ...p, blob: await blobToDataUrl(p.blob) })),
    ),
  };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export async function importBackup(file: File) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'mechanic-app') throw new Error('This is not a Mechanic App backup file.');
  const photos: Photo[] = await Promise.all(
    (data.photos ?? []).map(async (p: Photo & { blob: string }) => ({
      ...p,
      blob: await (await fetch(p.blob)).blob(),
    })),
  );
  await db.transaction('rw', [db.settings, db.customers, db.vehicles, db.jobs, db.photos], async () => {
    await Promise.all([
      db.settings.clear(),
      db.customers.clear(),
      db.vehicles.clear(),
      db.jobs.clear(),
      db.photos.clear(),
    ]);
    await db.settings.bulkPut(data.settings ?? []);
    await db.customers.bulkPut(data.customers ?? []);
    await db.vehicles.bulkPut(data.vehicles ?? []);
    await db.jobs.bulkPut(data.jobs ?? []);
    await db.photos.bulkPut(photos);
  });
}
