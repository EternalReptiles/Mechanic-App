import type { CheckItem, CheckResult, InspectionTemplateItem } from './types';
import { uid } from './utils';

const rating = (label: string): InspectionTemplateItem => ({ label, kind: 'rating' });
const pads = (label: string): InspectionTemplateItem => ({ label, kind: 'measure', unit: 'mm', positions: ['L', 'R'], thresholds: { urgentBelow: 3, soonBelow: 5 } });
const rotors = (label: string): InspectionTemplateItem => ({ label, kind: 'measure', unit: 'mm', positions: ['L', 'R'] });
const BATTERY: InspectionTemplateItem = { label: 'Battery test', kind: 'battery' };
const TREAD: InspectionTemplateItem = { label: 'Tyre tread', kind: 'measure', unit: 'mm', positions: ['FL', 'FR', 'RL', 'RR'], thresholds: { urgentBelow: 1.5, soonBelow: 3 } };

/** Standard vehicle inspection (owners can edit it in Settings → Job checklists). */
export const DEFAULT_INSPECTION: InspectionTemplateItem[] = [
  rating('Coolant level'),
  rating('Brake fluid'),
  rating('Power steering / transmission fluid'),
  BATTERY,
  rating('Drive belts'),
  rating('Hoses & leaks'),
  pads('Front brake pads'),
  pads('Rear brake pads / shoes'),
  rotors('Front rotors'),
  rotors('Rear rotors / drums'),
  TREAD,
  rating('Tyre pressures'),
  rating('Suspension & steering'),
  rating('Lights & indicators'),
  rating('Wipers & washers'),
  rating('Exhaust'),
  rating('Air filter'),
];

/**
 * Turns saved settings (older versions stored plain labels) into inspection items, upgrading the
 * old generic items to measured ones and dropping the oil level check (oil is replaced at service).
 */
export function normalizeInspection(t?: (string | InspectionTemplateItem)[]): InspectionTemplateItem[] {
  if (!t || !t.length) return DEFAULT_INSPECTION;
  const out: InspectionTemplateItem[] = [];
  for (const x of t) {
    if (typeof x !== 'string') { out.push(x); continue; }
    const label = x.trim();
    if (!label) continue;
    if (/^engine oil level/i.test(label)) continue;
    if (/^battery/i.test(label)) out.push(BATTERY);
    else if (/^front brakes$/i.test(label)) out.push(pads('Front brake pads'), rotors('Front rotors'));
    else if (/^rear brakes$/i.test(label)) out.push(pads('Rear brake pads / shoes'), rotors('Rear rotors / drums'));
    else if (/^tyres/i.test(label)) out.push(TREAD, rating('Tyre pressures'));
    else out.push(rating(label));
  }
  return out;
}

export function itemsFromTemplate(t: InspectionTemplateItem[]): CheckItem[] {
  return t.map((it) => ({ id: uid(), label: it.label, result: '', note: '', kind: it.kind, unit: it.unit, positions: it.positions, thresholds: it.thresholds, readings: it.kind === 'measure' ? {} : undefined, battery: it.kind === 'battery' ? {} : undefined }));
}

export const BATTERY_RESULTS: { label: string; result: CheckResult }[] = [
  { label: 'Good', result: 'ok' },
  { label: 'Recharge', result: 'attention' },
  { label: 'Replace', result: 'urgent' },
  { label: 'Not tested', result: 'na' },
];

export function batteryHealth(b?: { cca?: number | null; rated?: number | null }): number | null {
  if (!b?.cca || !b?.rated) return null;
  return Math.round((b.cca / b.rated) * 100);
}

/** Rating suggested by the lowest reading (null if no thresholds or no readings). */
export function autoRating(item: CheckItem): CheckResult | null {
  const vals = Object.values(item.readings ?? {}).filter((v): v is number => typeof v === 'number');
  if (!vals.length || !item.thresholds) return null;
  const min = Math.min(...vals);
  if (item.thresholds.urgentBelow !== undefined && min < item.thresholds.urgentBelow) return 'urgent';
  if (item.thresholds.soonBelow !== undefined && min < item.thresholds.soonBelow) return 'attention';
  return 'ok';
}

/** Readings as text for reports, e.g. "L 3 mm · R 3.5 mm" or "12.4 V · 520 of 600 CCA (87%)". */
export function readingsText(item: CheckItem): string {
  if (item.kind === 'battery' && item.battery) {
    const b = item.battery;
    const parts: string[] = [];
    if (b.volts) parts.push(`${b.volts} V`);
    if (b.cca) parts.push(b.rated ? `${b.cca} of ${b.rated} CCA (${batteryHealth(b)}%)` : `${b.cca} CCA`);
    return parts.join(' · ');
  }
  if (item.kind === 'measure' && item.readings) {
    return (item.positions ?? Object.keys(item.readings))
      .filter((p) => typeof item.readings?.[p] === 'number')
      .map((p) => `${p} ${item.readings![p]} ${item.unit ?? ''}`.trim())
      .join(' · ');
  }
  return '';
}
