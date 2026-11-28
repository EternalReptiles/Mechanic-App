import { useSyncExternalStore } from 'react';
import { changeListener, clock, db, getMeta, jobNumbers, serverNow, setMeta, SYNCED_TABLES, type SyncedTable } from '../db';
import { supabase, withTimeout } from './supabase';

/*
 * Offline-first sync.
 *  - Every local write is stamped with updatedAt and marked _dirty (see db.ts).
 *  - push(): uploads dirty records + deletions. The server keeps the newest updatedAt (last write wins).
 *  - pull(): downloads rows changed on the server since the last pull (by server timestamp).
 */

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'offline' | 'error';
  lastSyncedAt: number | null;
  pending: number;
  error?: string;
}

let status: SyncStatus = { state: 'idle', lastSyncedAt: null, pending: 0 };
const listeners = new Set<() => void>();
function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

let businessId: string | null = null;
let running = false;
let again = false;
let debounce: ReturnType<typeof setTimeout> | undefined;
let interval: ReturnType<typeof setInterval> | undefined;

const PULL_EVERY_MS = 30_000;
const PAGE = 500;
const OVERLAP_MS = 60_000;

function schedule(ms: number) {
  clearTimeout(debounce);
  debounce = setTimeout(() => void syncNow(), ms);
}
const onOnline = () => schedule(200);
const onVisible = () => document.visibilityState === 'visible' && schedule(200);

export function startSync(bid: string) {
  businessId = bid;
  changeListener.onLocalChange = () => {
    void refreshPending();
    schedule(1500);
  };
  jobNumbers.allocateRemote = async () => {
    if (!businessId || !navigator.onLine) return null;
    const { data, error } = await withTimeout(supabase.rpc('allocate_job_number', { bid: businessId }), 4000);
    return error ? null : (data as number);
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  interval = setInterval(() => void syncNow(), PULL_EVERY_MS);
  void syncNow();
}

export function stopSync() {
  businessId = null;
  changeListener.onLocalChange = () => {};
  jobNumbers.allocateRemote = async () => null;
  window.removeEventListener('online', onOnline);
  document.removeEventListener('visibilitychange', onVisible);
  clearInterval(interval);
  clearTimeout(debounce);
}

export async function pendingCount(): Promise<number> {
  let n = await db.tombstones.count();
  for (const t of SYNCED_TABLES) n += await db.table(t).where('_dirty').equals(1).count();
  return n;
}
async function refreshPending() {
  setStatus({ pending: await pendingCount() });
}

export async function syncNow(): Promise<void> {
  if (!businessId) return;
  if (running) {
    again = true;
    return;
  }
  if (!navigator.onLine) {
    setStatus({ state: 'offline' });
    await refreshPending();
    return;
  }
  running = true;
  setStatus({ state: 'syncing' });
  try {
    await syncClock();
    try {
      await push(businessId);
      await pull(businessId);
    } catch (e) {
      // The saved login went stale (e.g. the computer slept through a refresh): get a fresh one and try once more.
      if (!isAuthError(e)) throw e;
      const { error } = await supabase.auth.refreshSession();
      if (error) throw new Error('Your login has expired – sign out and sign in again (your changes are kept until they upload).');
      await push(businessId);
      await pull(businessId);
    }
    setStatus({ state: 'idle', lastSyncedAt: Date.now(), error: undefined });
  } catch (e) {
    const msg = isAuthError(e)
      ? 'Your login has expired – sign out and sign in again (your changes are kept until they upload).'
      : e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
    setStatus({ state: navigator.onLine ? 'error' : 'offline', error: msg });
  } finally {
    running = false;
    await refreshPending();
    if (again) {
      again = false;
      schedule(300);
    }
  }
}

type Rec = Record<string, unknown> & { id: string; updatedAt?: number; _dirty?: number };

function payload(r: Rec) {
  const { _dirty: _d, blob: _b, ...data } = r;
  return data;
}

/** Learns how far this device's clock is from the server's (once per sync; cheap). */
async function syncClock() {
  const t0 = Date.now();
  const { data, error } = await supabase.rpc('server_now');
  const t1 = Date.now();
  if (error || typeof data !== 'number' || t1 - t0 > 5000) return;
  const offset = data - (t0 + t1) / 2;
  // Only bother when it's meaningfully off (network jitter is a few hundred ms).
  clock.set(Math.abs(offset) > 2000 ? offset : 0);
}

const isAuthError = (e: unknown) => {
  const x = e as { code?: string; message?: string; status?: number };
  return x?.status === 401 || x?.code === 'PGRST301' || x?.code === 'PGRST303' || /jwt|expired|invalid.*token|unauthori[sz]ed/i.test(x?.message ?? '');
};

const isPermissionError = (e: { code?: string; message?: string }) =>
  e.code === '42501' || /row-level security/i.test(e.message ?? '');

async function push(bid: string) {
  for (const table of SYNCED_TABLES) {
    const t = db.table(table);
    const dirty = (await t.where('_dirty').equals(1).toArray()) as Rec[];
    if (!dirty.length) continue;

    if (table === 'photos') {
      for (const p of dirty) {
        if (!p.remotePath && p.blob instanceof Blob) {
          const path = `${bid}/${p.id}.jpg`;
          const { error } = await supabase.storage
            .from('photos')
            .upload(path, p.blob, { upsert: true, contentType: p.blob.type || 'image/jpeg' });
          if (error) throw error;
          p.remotePath = path;
          await t.update(p.id, { remotePath: path, _remote: 1 });
        }
      }
    }

    for (let i = 0; i < dirty.length; i += 200) {
      const chunk = dirty.slice(i, i + 200);
      const rows = chunk.map((r) => ({
        business_id: bid,
        id: r.id,
        data: payload(r),
        updated_at: Math.round(r.updatedAt ?? serverNow()),
        deleted: false,
      }));
      const { error } = await supabase.from(table).upsert(rows, { onConflict: 'business_id,id' });
      // Not allowed (e.g. a technician editing business settings): drop the local change, server copy wins.
      if (error && !isPermissionError(error)) throw error;
    }

    await db.transaction('rw', t, async () => {
      for (const r of dirty) {
        const cur = (await t.get(r.id)) as Rec | undefined;
        if (cur && cur.updatedAt === r.updatedAt) await t.put({ ...cur, _dirty: 0, _remote: 1 });
      }
    });
  }

  const tombs = await db.tombstones.toArray();
  if (!tombs.length) return;
  for (const table of SYNCED_TABLES) {
    const mine = tombs.filter((x) => x.table === table);
    if (!mine.length) continue;
    const { error } = await supabase.from(table).upsert(
      mine.map((x) => ({ business_id: bid, id: x.id, data: {}, updated_at: Math.round(x.at), deleted: true })),
      { onConflict: 'business_id,id' },
    );
    if (error && !isPermissionError(error)) throw error;
    if (table === 'photos') {
      await supabase.storage.from('photos').remove(mine.map((x) => `${bid}/${x.id}.jpg`));
    }
  }
  await db.tombstones.bulkDelete(tombs.map((x) => x.key));
}

interface Row {
  id: string;
  data: Rec;
  updated_at: number;
  deleted: boolean;
  server_ts: string;
}

async function pull(bid: string) {
  for (const table of SYNCED_TABLES) {
    const cursorKey = `cursor:${table}`;
    const start = (await getMeta<string>(cursorKey)) ?? '1970-01-01T00:00:00Z';
    let since = start;
    for (;;) {
      const { data, error } = await supabase
        .from(table)
        .select('id,data,updated_at,deleted,server_ts')
        .eq('business_id', bid)
        .gt('server_ts', since)
        .order('server_ts')
        .limit(PAGE);
      if (error) throw error;
      const rows = (data ?? []) as Row[];
      if (!rows.length) break;
      await apply(table, rows);
      since = rows[rows.length - 1].server_ts;
      if (rows.length < PAGE) break;
    }
    if (since !== start) {
      // Step back a little so rows from slow, late-committing uploads aren't missed next time.
      await setMeta(cursorKey, new Date(Date.parse(since) - OVERLAP_MS).toISOString());
    }
  }
}

async function apply(table: SyncedTable, rows: Row[]) {
  const t = db.table(table);
  await db.transaction('rw', t, db.tombstones, async () => {
    for (const row of rows) {
      const updatedAt = Number(row.updated_at);
      const local = (await t.get(row.id)) as Rec | undefined;
      if (local?._dirty && (local.updatedAt ?? 0) > updatedAt) continue; // our newer edit will be pushed
      const tomb = await db.tombstones.get(`${table}:${row.id}`);
      if (tomb && tomb.at >= updatedAt) continue; // our pending delete wins
      if (row.deleted) {
        if (local) await t.delete(row.id);
        continue;
      }
      await t.put({
        ...(table === 'photos' && local?.blob ? { blob: local.blob } : {}),
        ...row.data,
        id: row.id,
        updatedAt,
        _dirty: 0,
        _remote: 1,
      });
    }
  });
}
