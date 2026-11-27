import { useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';

/** Settings → owner only: close the business account (kept 90 days so it can be reopened, then deleted). */
export default function CloseAccount() {
  const { businessId, role, refreshPlan } = useCloud();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (role !== 'owner') return null;

  async function close() {
    setErr('');
    setBusy(true);
    const { error } = await supabase.rpc('close_business', { bid: businessId });
    setBusy(false);
    if (error) return setErr(error.message);
    await refreshPlan();
  }

  return (
    <section className="card danger-zone">
      <h2>Close business account</h2>
      {!open ? (
        <>
          <p className="muted small">
            Stops this business using Spannr. Everything is kept for 90 days in case you change your mind, then permanently deleted.
          </p>
          <button className="btn ghost danger" onClick={() => setOpen(true)}>Close account…</button>
        </>
      ) : (
        <>
          <p className="small">
            Download a backup first if you want a copy. Your team will lose access straight away. You can reopen within 90 days; after that,
            all jobs, customers, photos and videos are deleted for good.
          </p>
          <label className="field">
            <span>Type CLOSE to confirm</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" />
          </label>
          {err && <p className="error">{err}</p>}
          <div className="row wrap">
            <button className="btn danger" disabled={typed.trim().toUpperCase() !== 'CLOSE' || busy} onClick={close}>
              {busy ? 'Closing…' : 'Close business account'}
            </button>
            <button className="btn ghost" onClick={() => { setOpen(false); setTyped(''); setErr(''); }}>Cancel</button>
          </div>
        </>
      )}
    </section>
  );
}
