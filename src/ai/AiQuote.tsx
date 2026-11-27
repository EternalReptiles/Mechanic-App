import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { db } from '../db';
import type { Job, LineItem, Vehicle } from '../types';
import { money, uid } from '../utils';
import { aiAssist } from './ai';

type Line = Omit<LineItem, 'id'> & { repair: string };
const RESULT: Record<string, string> = { urgent: 'URGENT', attention: 'Needs attention soon', ok: 'OK' };

/** Quote from inspection: suggests labour and parts for what the inspection found. */
export default function AiQuote({ job, vehicle, labourRate, update }: { job: Job; vehicle?: Vehicle; labourRate: number; update: (p: Partial<Job>) => void }) {
  const { businessId } = useCloud();
  const catalog = useLiveQuery(() => db.catalog.toArray(), []) ?? [];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [lines, setLines] = useState<(Line & { on: boolean })[] | null>(null);
  const [note, setNote] = useState('');

  const flagged = (job.checklist ?? []).filter((c) => c.result === 'urgent' || c.result === 'attention');
  if (!flagged.length && !lines) return null;

  async function run() {
    setErr('');
    setBusy(true);
    try {
      const findings = flagged.map((c) => {
        const readings = c.readings
          ? Object.entries(c.readings).filter(([, v]) => v != null).map(([k, v]) => `${k} ${v}${c.unit ?? ''}`).join(', ')
          : '';
        return `- ${c.label}: ${RESULT[c.result]}${readings ? ` (${readings})` : ''}${c.note ? ` – ${c.note}` : ''}`;
      }).join('\n');
      const priceList = catalog.map((c) => `${c.name}: ${c.lines.map((l) => `${l.description} ${l.qty} × $${l.unitPrice}`).join('; ')}`).join('\n');
      const r = await aiAssist<{ lines: Line[]; note: string }>('quote', businessId, {
        findings, priceList, labourRate, notes: job.workNotes, title: job.title,
        vehicle: [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' '),
      });
      setLines(r.lines.map((l) => ({ ...l, on: true })));
      setNote(r.note);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function add() {
    const chosen: LineItem[] = lines!.filter((l) => l.on).map(({ on: _on, ...l }) => ({ ...l, id: uid() }));
    update({ lineItems: [...job.lineItems, ...chosen] });
    setLines(null);
  }

  const repairs = [...new Set(lines?.map((l) => l.repair) ?? [])];
  return (
    <section className="card ai-box">
      {!lines ? (
        <div className="row between wrap">
          <span>
            <strong>✨ Quote from this inspection</strong><br />
            <span className="small muted">{flagged.length} item{flagged.length > 1 ? 's' : ''} flagged – AI suggests the labour and parts.</span>
          </span>
          <button className="btn ai-btn" disabled={busy} onClick={() => void run()}>{busy ? 'Working it out…' : '✨ Suggest quote'}</button>
        </div>
      ) : (
        <>
          <h2>✨ Suggested quote</h2>
          {repairs.map((rep) => (
            <div key={rep} className="ai-repair">
              <h3>{rep}</h3>
              {lines.map((l, i) => l.repair !== rep ? null : (
                <label key={i} className="row between ai-line">
                  <span className="row">
                    <input type="checkbox" checked={l.on} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)))} />
                    <span>{l.description}<br /><small className="muted">{l.type === 'labour' ? `${l.qty} h` : `Qty ${l.qty}`}</small></span>
                  </span>
                  <span>{l.unitPrice ? money(l.qty * l.unitPrice) : <small className="muted">price?</small>}</span>
                </label>
              ))}
            </div>
          ))}
          {note && <p className="small muted">💡 {note}</p>}
          <div className="row wrap">
            <button className="btn primary grow" disabled={!lines.some((l) => l.on)} onClick={add}>Add to job</button>
            <button className="btn ghost" onClick={() => setLines(null)}>Discard</button>
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>Hours and parts are AI estimates – check them and fill in any missing prices on the Billing tab.</p>
        </>
      )}
      {err && <p className="error small">{err}</p>}
    </section>
  );
}
