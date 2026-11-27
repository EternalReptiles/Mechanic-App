import { useEffect, useState } from 'react';
import { syncNow, useSyncStatus } from './sync';

function ago(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} hr ago`;
}

export default function SyncBadge({ detailed }: { detailed?: boolean }) {
  const s = useSyncStatus();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const pending = s.pending ? ` · ${s.pending} to upload` : '';
  const [icon, text, cls] =
    s.state === 'syncing'
      ? ['⟳', 'Syncing…', 'sync-busy']
      : s.state === 'offline'
        ? ['⚠', `Offline – saved on phone${pending}`, 'sync-off']
        : s.state === 'error'
          ? ['⚠', `Sync problem${pending}`, 'sync-err']
          : s.pending
            ? ['☁', `${s.pending} to upload`, 'sync-busy']
            : ['✓', s.lastSyncedAt ? `Synced ${ago(s.lastSyncedAt)}` : 'Synced', 'sync-ok'];

  return (
    <button className={`sync-badge ${cls}`} onClick={() => {
      if (s.state === 'error' && s.error) alert(`Sync problem: ${s.error}\n\nSpannr will keep trying. Your changes are saved on this device.`);
      void syncNow();
    }} title={s.error ?? 'Tap to sync now'}>
      <span>{icon}</span> {detailed || s.state !== 'idle' || s.pending ? text : ''}
      {detailed && s.state === 'error' && s.error && <span className="small"> – {s.error}</span>}
    </button>
  );
}
