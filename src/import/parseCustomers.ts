import type { Customer } from '../types';

export type Cell = string | number | boolean | Date | null | undefined;
export type Sheet = Cell[][];

/** Reads a CSV file (quotes, commas and line breaks inside quotes, Excel's BOM). */
export function parseCsv(text: string): Sheet {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}

const clean = (v: Cell) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

/**
 * Australian phone numbers, repaired: spreadsheets turn 0404 123 456 into the number 404123456
 * (and +61 numbers lose their format), so the leading 0 is put back.
 */
export function auPhone(v: Cell): string {
  if (v == null || v === '') return '';
  // "4.12E+08" saved as text: the real digits are gone.
  if (typeof v === 'string' && /^\s*\d(\.\d+)?e\+?\d+\s*$/i.test(v)) return '';
  let d = (typeof v === 'number' ? Math.round(v).toString() : String(v)).replace(/\D/g, '');
  if (d.startsWith('61') && d.length === 11) d = `0${d.slice(2)}`;
  else if (d.length === 9 && /^[2-478]/.test(d)) d = `0${d}`;
  if (d.length !== 10 || !d.startsWith('0')) return String(v).trim();
  return d.startsWith('04') || d.startsWith('05')
    ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`
    : `${d.slice(0, 2)} ${d.slice(2, 6)} ${d.slice(6)}`;
}
const digits = (s: string) => s.replace(/\D/g, '');

/** "Adolphs, Gabby" → "Gabby Adolphs"; company names are left alone. */
function personName(name: string, first: string, last: string) {
  const m = name.match(/^([^,]+),\s*([^,]+)$/);
  if (m) return `${m[2].trim()} ${m[1].trim()}`.trim();
  if (name.replace(/,/g, '').trim()) return name.replace(/^,\s*/, '').trim();
  return `${first} ${last}`.trim();
}

export type ImportRow = Omit<Customer, 'id' | 'createdAt'> & { status: 'new' | 'duplicate' | 'skip'; reason?: string };
export type ImportResult = { source: string; rows: ImportRow[]; damagedPhones: number };

/** Turns a spreadsheet of customers (ServiceM8 client list, or any sheet with name/phone/email columns) into customers. */
export function mapCustomers(sheet: Sheet, existing: Customer[]): ImportResult {
  if (sheet.length < 2) throw new Error('That file has no customers in it.');
  const head = sheet[0].map((h) => clean(h).toLowerCase());
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = head.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const isSm8 = head.includes('billing contact first') && head.includes('company address');
  const c = {
    name: col('name', 'customer name', 'customer', 'client', 'client name', 'full name', 'company name', 'company'),
    first: col('contact first', 'billing contact first', 'first name', 'firstname', 'given name'),
    last: col('contact last', 'billing contact last', 'last name', 'lastname', 'surname', 'family name'),
    mobile: col('mobile number', 'mobile', 'mobile phone', 'cell', 'billing mobile number'),
    mobile2: col('billing mobile number'),
    phone: col('telephone number', 'phone', 'phone number', 'telephone', 'home phone', 'work phone', 'billing telephone number'),
    phone2: col('billing telephone number'),
    email: col('email address', 'email', 'e-mail', 'billing email address'),
    email2: col('billing email address'),
    address: col('company address', 'address', 'billing address', 'street address', 'job address'),
    street: col('billing address street', 'street', 'address 1', 'address line 1'),
    city: col('billing address city', 'city', 'suburb', 'town'),
    state: col('billing address state', 'state'),
    postcode: col('billing address postcode', 'postcode', 'post code', 'zip'),
    terms: col('payment terms'),
    notes: col('notes', 'note', 'comments'),
  };
  if (c.name < 0 && c.first < 0) throw new Error("Couldn't find a Name column. The first row of the file should be the column headings.");
  if (c.mobile < 0 && c.phone < 0 && c.email < 0) throw new Error("Couldn't find phone or email columns in that file.");

  const get = (r: Cell[], i: number) => (i >= 0 ? r[i] : undefined);
  const seenPhones = new Set(existing.map((x) => digits(x.phone)).filter((d) => d.length >= 8));
  const seenEmails = new Set(existing.map((x) => x.email.trim().toLowerCase()).filter(Boolean));
  const seenNames = new Set(existing.map((x) => x.name.trim().toLowerCase()).filter(Boolean));
  const filePhones = new Set<string>(), fileEmails = new Set<string>(), fileNames = new Set<string>();

  let damagedPhones = 0;
  const rows: ImportRow[] = sheet.slice(1).map((r) => {
    if ([c.mobile, c.mobile2, c.phone, c.phone2].some((i) => i >= 0 && typeof r[i] === 'string' && /^\s*\d(\.\d+)?e\+?\d+\s*$/i.test(String(r[i])))) damagedPhones++;
    const name = personName(clean(get(r, c.name)), clean(get(r, c.first)), clean(get(r, c.last)));
    const phones = [get(r, c.mobile), get(r, c.mobile2), get(r, c.phone), get(r, c.phone2)].map(auPhone).filter(Boolean);
    const uniquePhones = [...new Set(phones.map(digits))].map((d) => phones.find((p) => digits(p) === d)!);
    const emails = [...new Set([clean(get(r, c.email)), clean(get(r, c.email2))].filter((e) => e.includes('@')).map((e) => e.toLowerCase()))];
    const street = clean(get(r, c.street));
    const address = clean(get(r, c.address)) || [street, clean(get(r, c.city)), clean(get(r, c.state)), clean(get(r, c.postcode))].filter(Boolean).join(' ');
    const notes = [
      clean(get(r, c.notes)),
      uniquePhones.length > 1 ? `Other phone: ${uniquePhones.slice(1).join(', ')}` : '',
      emails.length > 1 ? `Other email: ${emails.slice(1).join(', ')}` : '',
      clean(get(r, c.terms)) ? `Payment terms: ${clean(get(r, c.terms))}` : '',
      `Imported from ${isSm8 ? 'ServiceM8' : 'spreadsheet'}`,
    ].filter(Boolean).join('\n');
    const row: ImportRow = { name, phone: uniquePhones[0] ?? '', email: emails[0] ?? '', address, notes, status: 'new' };

    if (!name) return { ...row, status: 'skip', reason: 'No name' };
    if (/^(cash sale|cash customer|walk[ -]?in)$/i.test(name)) return { ...row, status: 'skip', reason: 'Cash sale' };
    const pd = digits(row.phone);
    const n = name.toLowerCase();
    const match = (ph: Set<string>, em: Set<string>, nm: Set<string>) =>
      nm.has(n) && ((pd.length >= 8 && ph.has(pd)) || (!!row.email && em.has(row.email)) || (!pd && !row.email));
    if (match(seenPhones, seenEmails, seenNames)) return { ...row, status: 'duplicate', reason: 'Already in Spannr' };
    if (match(filePhones, fileEmails, fileNames)) return { ...row, status: 'duplicate', reason: 'Listed twice in the file' };
    fileNames.add(n);
    if (pd.length >= 8) filePhones.add(pd);
    if (row.email) fileEmails.add(row.email);
    return row;
  });
  return { source: isSm8 ? 'ServiceM8' : 'spreadsheet', rows, damagedPhones };
}
