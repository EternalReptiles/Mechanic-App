export type JobStatus =
  | 'quote'
  | 'scheduled'
  | 'in_progress'
  | 'waiting'
  | 'completed'
  | 'invoiced'
  | 'paid'
  | 'cancelled';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  createdAt: string;
}

export interface Vehicle {
  id: string;
  customerId: string;
  rego: string;
  make: string;
  model: string;
  year: string;
  vin: string;
  odometer: string;
  notes: string;
  /** ISO date (YYYY-MM-DD) */
  nextServiceDate?: string;
  nextServiceKm?: string;
  /** ISO date (YYYY-MM-DD) */
  regoExpiry?: string;
}

export type LineItemType = 'labour' | 'part' | 'other';

export interface LineItem {
  id: string;
  type: LineItemType;
  description: string;
  qty: number;
  /** Unit price excluding GST */
  unitPrice: number;
}

export type CheckResult = '' | 'ok' | 'attention' | 'urgent' | 'na';

export interface CheckItem {
  id: string;
  label: string;
  result: CheckResult;
  note: string;
}

export type PaymentMethod = '' | 'cash' | 'card' | 'transfer' | 'other';

export interface Job {
  id: string;
  number: number;
  customerId: string;
  vehicleId: string;
  status: JobStatus;
  title: string;
  description: string;
  siteAddress: string;
  /** ISO string, empty when unscheduled */
  scheduledStart: string;
  durationMins: number;
  odometer: string;
  lineItems: LineItem[];
  workNotes: string;
  createdAt: string;
  invoicedAt: string;
  paidAt: string;
  checklist?: CheckItem[];
  paymentMethod?: PaymentMethod;
  /** Customer sign-off, PNG data URL */
  signature?: string;
  signedName?: string;
  signedAt?: string;
  /** Where the work happens. Missing = 'onsite' (mobile). */
  location?: JobLocation;
  /** User id of the assigned technician */
  assignedTo?: string;
  keyTag?: string;
  droppedOffAt?: string;
  promisedAt?: string;
  collectedAt?: string;
}

export type JobLocation = 'onsite' | 'workshop';
export type BusinessType = 'mobile' | 'workshop' | 'both';

/** A saved price-list entry: a single item, or a package of several lines (e.g. "Logbook service – 4cyl"). */
export interface CatalogItem {
  id: string;
  name: string;
  lines: Omit<LineItem, 'id'>[];
}

export interface Photo {
  id: string;
  jobId: string;
  /** Missing on devices that haven't downloaded the photo yet. */
  blob?: Blob;
  /** Path in cloud storage once uploaded. */
  remotePath?: string;
  caption: string;
  createdAt: string;
}

export interface Settings {
  id: 'settings';
  businessName: string;
  abn: string;
  phone: string;
  email: string;
  address: string;
  website: string;
  logo: string; // data URL
  bankName: string;
  bsb: string;
  accountNumber: string;
  accountName: string;
  labourRate: number;
  gstRegistered: boolean;
  paymentTermsDays: number;
  nextJobNumber: number;
  invoiceFooter: string;
  quoteFooter: string;
  checklistTemplate: string[];
  serviceIntervalMonths: number;
  serviceIntervalKm: number;
  reminderMessage: string;
  businessType: BusinessType;
  readyMessage: string;
}
