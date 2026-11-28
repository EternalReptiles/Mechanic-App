import { useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import { useSettings } from '../hooks';
import { Field } from './ui';

export type RegoResult = { make: string; model: string; year: string; body: string; engine: string; description: string };
const STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'ACT', 'NT'];
const TZ_STATE: Record<string, string> = {
  'Australia/Brisbane': 'QLD', 'Australia/Lindeman': 'QLD', 'Australia/Sydney': 'NSW', 'Australia/Melbourne': 'VIC',
  'Australia/Adelaide': 'SA', 'Australia/Perth': 'WA', 'Australia/Hobart': 'TAS', 'Australia/Darwin': 'NT', 'Australia/Canberra': 'ACT',
};

/** Rego field with state and a "Look up" button that fills in make, model and year from the plate. */
export default function RegoLookup({ rego, onRego, onFound }: { rego: string; onRego: (v: string) => void; onFound: (r: RegoResult) => void }) {
  const { businessId } = useCloud();
  const settings = useSettings();
  const [state, setStateRaw] = useState(() => {
    try { return localStorage.getItem('spannr-rego-state') || TZ_STATE[settings.timezone ?? ''] || 'QLD'; } catch { return 'QLD'; }
  });
  const setState = (s: string) => { setStateRaw(s); try { localStorage.setItem('spannr-rego-state', s); } catch { /* ignore */ } };
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [options, setOptions] = useState<RegoResult[] | null>(null);

  async function look() {
    setMsg(''); setOptions(null);
    if (!navigator.onLine) return setMsg('Rego lookup needs signal.');
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('rego-lookup', { body: { businessId, plate: rego, state } });
      const body = error ? await (error as { context?: Response }).context?.json?.().catch(() => null) : data;
      if (body?.error) return setMsg(body.error);
      if (!body?.found) return setMsg(`No car found for ${rego.toUpperCase()} in ${state}. Check the plate and state, or type the details in.`);
      onFound(body.vehicle);
      if (body.options?.length > 1) setOptions(body.options);
      else setMsg(`✓ ${body.vehicle.description || [body.vehicle.year, body.vehicle.make, body.vehicle.model].join(' ')}`);
    } catch {
      setMsg("Couldn't reach the rego service – type the details in for now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wide rego-lookup">
      <Field label="Rego">
        <div className="row rego-row">
          <input className="grow" value={rego} autoCapitalize="characters" onChange={(e) => onRego(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && rego.trim()) { e.preventDefault(); void look(); } }} />
          <select value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
            {STATES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button type="button" className="btn" disabled={busy || rego.trim().length < 2} onClick={() => void look()}>{busy ? 'Looking…' : '🔍 Look up'}</button>
        </div>
      </Field>
      {options && (
        <div className="rego-options">
          <p className="small muted" style={{ margin: '4px 0' }}>A few versions match this plate – pick the right one:</p>
          {options.map((o) => (
            <button key={o.description} type="button" className="btn small block" onClick={() => { onFound(o); setOptions(null); setMsg(`✓ ${o.description}`); }}>
              {o.description || `${o.year} ${o.make} ${o.model}`}
            </button>
          ))}
        </div>
      )}
      {msg && <p className="small muted" style={{ margin: '4px 0 0' }}>{msg}</p>}
    </div>
  );
}
