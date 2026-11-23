import type { JobStatus, LineItem, Vehicle } from './types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const money = (n: number) =>
  n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

export function totals(items: LineItem[], gstRegistered: boolean) {
  const subtotal = round2(items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0));
  const gst = gstRegistered ? round2(subtotal * 0.1) : 0;
  return { subtotal, gst, total: round2(subtotal + gst) };
}

export const fmtDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export const fmtTime = (iso: string) =>
  iso ? new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : '';

export const fmtDateTime = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString('en-AU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Unscheduled';

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO string -> value for <input type="datetime-local"> */
export function toLocalInput(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string {
  return v ? new Date(v).toISOString() : '';
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (r.getDay() + 6) % 7; // Monday = 0
  r.setDate(r.getDate() - day);
  return r;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function vehicleLabel(v?: Vehicle): string {
  if (!v) return '';
  const name = [v.year, v.make, v.model].filter(Boolean).join(' ');
  return [v.rego?.toUpperCase(), name].filter(Boolean).join(' · ');
}

export const STATUS: Record<JobStatus, { label: string; color: string }> = {
  quote: { label: 'Quote', color: '#8b5cf6' },
  scheduled: { label: 'Scheduled', color: '#0ea5e9' },
  in_progress: { label: 'In progress', color: '#f59e0b' },
  waiting: { label: 'On hold', color: '#a16207' },
  completed: { label: 'Completed', color: '#10b981' },
  invoiced: { label: 'Invoiced', color: '#ef4444' },
  paid: { label: 'Paid', color: '#64748b' },
  cancelled: { label: 'Cancelled', color: '#94a3b8' },
};

export const STATUS_ORDER: JobStatus[] = [
  'quote',
  'scheduled',
  'in_progress',
  'waiting',
  'completed',
  'invoiced',
  'paid',
  'cancelled',
];

export function mapsUrl(address: string) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export function telUrl(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export function smsUrl(phone: string, body = '') {
  return `sms:${phone.replace(/[^\d+]/g, '')}${body ? `?&body=${encodeURIComponent(body)}` : ''}`;
}

/** Downscale a photo before storing it, to keep the on-device database small. */
export async function resizeImage(file: File, maxSize = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.82));
}

/** Today as YYYY-MM-DD in local time. */
export const todayISO = () => dayKey(new Date());

export function addMonthsISO(months: number, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth() + months, from.getDate());
  return dayKey(d);
}

/** Whole days from today until a YYYY-MM-DD date (negative = overdue). */
export function daysUntil(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return Math.round((target - today) / 86400000);
}

export const fmtDay = (isoDate: string) => {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** Fills {name} {business} {vehicle} {date} {rego} placeholders in a message template. */
export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';

export const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  transfer: 'Bank transfer',
  other: 'Other',
};

export const CHECK_LABEL: Record<string, { label: string; color: string }> = {
  ok: { label: 'OK', color: '#16a34a' },
  attention: { label: 'Needs attention soon', color: '#d97706' },
  urgent: { label: 'Urgent', color: '#dc2626' },
  na: { label: 'N/A', color: '#94a3b8' },
};

/** Short display name for a team member: "dave.smith@x.com" -> "Dave Smith" */
export function personName(email: string, name?: string): string {
  if (name) return name;
  return (email.split('@')[0] ?? '')
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}
