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
  /** Opt out of automatic booking confirmations and reminders */
  noAutoMessages?: boolean;
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
  /** Repair this line belongs to (e.g. "Front brakes"), so customers can approve repairs separately */
  repair?: string;
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
  /** Walk-around ids whose approved work has already been added to this job */
  appliedWalkarounds?: string[];
  /** Technician's job checklist (from a template) */
  tasks?: JobTask[];
  tasksTemplate?: string;
  /** Set when a technician marks the job finished */
  finishedAt?: string;
  finishedBy?: string;
  /** Checklist amounts (e.g. oil litres) already added to the invoice lines */
  taskLinesAdded?: boolean;
}

export type JobLocation = 'onsite' | 'workshop';

/** Field types for job checklists filled in by technicians. */
export type TaskFieldType = 'check' | 'yesno' | 'number' | 'text' | 'choice';

export interface TaskTemplateItem {
  id: string;
  label: string;
  type: TaskFieldType;
  /** e.g. "L", "mm", "km" for number fields */
  unit?: string;
  /** Options for choice fields */
  options?: string[];
  required?: boolean;
  /** Number fields: add the amount to the invoice as a part (qty = value) when the job is finished */
  invoice?: { description: string; unitPrice: number };
  /** Number fields: copy the value to the job/vehicle odometer */
  mapsTo?: 'odometer';
}

export interface JobTemplate {
  id: string;
  name: string;
  items: TaskTemplateItem[];
}

export interface JobTask extends TaskTemplateItem {
  value: string | number | boolean | null;
  note?: string;
}
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
  /** Terms & conditions customers agree to when signing. Placeholders: {business} {days} */
  terms: string;
  /** Brand colour (hex) for documents, customer pages and Stripe invoices */
  brandColor?: string;
  /** Job checklist templates for technicians (defaults used when missing) */
  jobTemplates?: JobTemplate[];
  /** IANA time zone used for message times and quiet hours, e.g. "Australia/Sydney" */
  timezone?: string;
  /** Automatic booking confirmations and reminders (sent by the server) */
  notify?: NotifySettings;
}

export interface NotifySettings {
  confirmEnabled: boolean;
  reminderEnabled: boolean;
  /** Hours before the booking to send the reminder */
  reminderHours: number;
  sms: boolean;
  email: boolean;
  /** When automatic messages were switched on (ms); earlier bookings aren't confirmed */
  enabledAt: number;
  confirmTemplate: string;
  reminderTemplate: string;
  /** Text/email a paid-invoice receipt when a customer pays by card (default on) */
  receiptEnabled?: boolean;
}
