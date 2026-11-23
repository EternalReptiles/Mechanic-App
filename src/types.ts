export type JobStatus =
  | 'quote'
  | 'scheduled'
  | 'in_progress'
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
}

export interface Photo {
  id: string;
  jobId: string;
  blob: Blob;
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
}
