import { useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import { PageHeader } from '../components/ui';
import { exportBackup } from '../db';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

/** Shown instead of the app while the business account is closed (within its 90 days). */
export default function ClosedBusiness() {
  const { businessId, role, plan, refreshPlan, signOut } = useCloud();
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const deleteOn = new Date(new Date(plan.closedAt!).getTime() + 90 * 86400000).toISOString();

  async function reopen() {
    setErr('');
    setBusy(true);
    const { error } = await supabase.rpc('reopen_business', { bid: businessId });
    setBusy(false);
    if (error) return setErr(error.message);
    await refreshPlan();
  }

  async function backup() {
    const blob = await exportBackup();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `spannr-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="content">
      <PageHeader title="Account closed" />
      <section className="card">
        <p style={{ marginTop: 0 }}>
          This business's Spannr account was closed on <strong>{fmt(plan.closedAt!)}</strong>. Its information will be permanently deleted on{' '}
          <strong>{fmt(deleteOn)}</strong>.
        </p>
        {role === 'owner' ? (
          <>
            <p className="small">Changed your mind? Reopen it and everything is just as you left it.</p>
            <div className="row wrap">
              <button className="btn primary grow" disabled={busy} onClick={reopen}>{busy ? 'Reopening…' : 'Reopen account'}</button>
              <button className="btn grow" onClick={() => void backup()}>Download a backup</button>
            </div>
          </>
        ) : (
          <p className="small">Only the owner can reopen it.</p>
        )}
        {err && <p className="error">{err}</p>}
        <button className="btn ghost block" style={{ marginTop: 12 }} onClick={() => void signOut()}>Sign out</button>
      </section>
    </div>
  );
}
