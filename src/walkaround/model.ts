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

export interface WalkContent {
  business: { name: string; phone: string; email: string; logo: string; abn: string };
  customerName: string;
  vehicle: string;
  message: string;
  gst: boolean;
  sentBy: string;
  items: WalkItem[];
}

export interface WalkRecord {
  id: string;
  job_id: string;
  token: string;
  created_at: string;
  expires_at: string;
  video_path: string | null;
  content: WalkContent;
  content_hash: string;
  viewed_at: string | null;
  responded_at: string | null;
  decisions: Record<string, 'approved' | 'declined'> | null;
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
