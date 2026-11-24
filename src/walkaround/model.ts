import type { LineItem } from '../types';
import { round2 } from '../utils';

export type Priority = 'urgent' | 'soon' | 'optional';

export const PRIORITY: Record<Priority, { label: string; color: string; help: string }> = {
  urgent: { label: 'Urgent', color: '#dc2626', help: 'Safety issue – fix now' },
  soon: { label: 'Recommended soon', color: '#d97706', help: 'Plan to fix in the next few months' },
  optional: { label: 'Optional', color: '#64748b', help: 'Nice to have' },
};

export interface WalkItem {
  id: string;
  title: string;
  note: string;
  priority: Priority;
  /** Prices ex GST */
  lines: Omit<LineItem, 'id'>[];
  /** Price the customer pays (inc GST when registered) */
  total: number;
}

export type RequestKind = 'walkaround' | 'quote' | 'completion';

export const KIND_LABEL: Record<RequestKind, string> = {
  walkaround: 'Video walk-around',
  quote: 'Quote',
  completion: 'Job sign-off',
};

export interface SignLine {
  description: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

/** A repair on a quote that the customer can approve or decline on its own. */
export interface SignRepair {
  id: string;
  title: string;
  lines: SignLine[];
  /** Job line ids, so the job can be updated to match the customer's choices */
  lineIds: string[];
  subtotal: number;
  /** What the customer pays (inc GST when registered) */
  total: number;
}

export interface WalkContent {
  business: { name: string; phone: string; email: string; logo: string; abn: string; brandColor?: string };
  customerName: string;
  vehicle: string;
  message: string;
  gst: boolean;
  sentBy: string;
  items: WalkItem[];
  /** Terms & conditions the customer must agree to (placeholders already filled) */
  terms?: string;
  // Quote approval / job sign-off only:
  jobNumber?: number;
  title?: string;
  description?: string;
  workNotes?: string;
  lines?: SignLine[];
  /** Quotes only: when there are 2+ repairs the customer chooses per repair */
  repairs?: SignRepair[];
  subtotal?: number;
  gstAmount?: number;
  total?: number;
  /** YYYY-MM-DD, job sign-off only */
  dueDate?: string;
}

export interface WalkRecord {
  id: string;
  kind: RequestKind;
  terms_agreed: boolean | null;
  job_id: string;
  token: string;
  created_at: string;
  expires_at: string;
  video_path: string | null;
  content: WalkContent;
  content_hash: string;
  viewed_at: string | null;
  responded_at: string | null;
  /** Walk-around: item id -> approved/declined. Quote: {outcome, reason}. */
  decisions: Record<string, string> | null;
  approved_total: number | null;
  signed_name: string | null;
  signature: string | null;
  signer_ip: string | null;
  signer_user_agent: string | null;
  seen_by_business_at: string | null;
}

export function itemTotal(lines: WalkItem['lines'], gst: boolean): number {
  const ex = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
  return round2(gst ? ex * 1.1 : ex);
}

export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const VIDEO_BUCKET = 'walkaround-videos';

export function videoUrl(path: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/${VIDEO_BUCKET}/${path}`;
}

export function shareLink(token: string): string {
  return `${window.location.origin}/v/${token}`;
}

export const fmtMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const consentText = (business: string) =>
  `By signing, I confirm I have watched the video and reviewed every item above. I authorise ${business} to carry out the work I have marked "Yes" at the prices shown. I understand the items I marked "No" were recommended to me, and I accept responsibility for not having them done at this time.`;

export function fillTerms(terms: string, business: string, days: number): string {
  return terms.replace(/\{business\}/g, business || 'the business').replace(/\{days\}/g, String(days)).trim();
}

/** Splits "Heading: text" lines for display. */
export function termLines(terms: string): { heading: string; text: string }[] {
  return terms
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^([^:]{2,40}):\s*(.*)$/);
      return m ? { heading: m[1], text: m[2] } : { heading: '', text: l };
    });
}

export const DECLINE_REASONS = ['Too expensive', 'Getting another quote', 'Not needed right now', 'Other'];

export interface QuoteOutcome {
  outcome: 'approved' | 'declined' | 'partial';
  reason: string;
  /** Per-repair choices (quotes with 2+ repairs) */
  items: Record<string, 'approved' | 'declined'>;
}

/** For quotes: whether the customer approved, declined, or approved some repairs – and why. */
export function quoteOutcome(decisions: unknown): QuoteOutcome | null {
  const d = decisions as { outcome?: string; reason?: string; items?: Record<string, 'approved' | 'declined'> } | null;
  if (!d || !['approved', 'declined', 'partial'].includes(d.outcome ?? '')) return null;
  return { outcome: d.outcome as QuoteOutcome['outcome'], reason: d.reason ?? '', items: d.items ?? {} };
}

export const partialStatement = (business: string, total: string) =>
  `I authorise ${business} to carry out the repairs I have marked "Yes" and agree to pay ${total} for them, on the terms and conditions below. I understand the repairs I marked "No" were recommended to me, and I accept responsibility for not having them done at this time.`;

export const declineStatement = (business: string) =>
  `I have reviewed the quote above and decline the work. I understand ${business} recommended this work and I accept responsibility for not having it done.`;

/** What the customer is agreeing to when they sign. */
export function signStatement(kind: RequestKind, business: string, total: string, due?: string, declined = false, partial = false): string {
  if (declined) return declineStatement(business);
  if (partial) return partialStatement(business, total);
  if (kind === 'quote')
    return `I authorise ${business} to carry out the work above and agree to pay ${total} for it, on the terms and conditions below.`;
  if (kind === 'completion')
    return `I confirm the work above has been completed and agree to pay ${total}${due ? ` by ${due}` : ''}, on the terms and conditions below.`;
  return consentText(business);
}
