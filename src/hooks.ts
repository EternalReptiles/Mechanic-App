import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { db, defaultSettings } from './db';
import type { Customer, Vehicle } from './types';

export function useSettings() {
  const s = useLiveQuery(() => db.settings.get('settings'), []);
  return { ...defaultSettings, ...s };
}

/** Lookup maps for customers and vehicles, used for rendering job lists. */
export function useLookups() {
  const customers = useLiveQuery(() => db.customers.toArray(), []) ?? [];
  const vehicles = useLiveQuery(() => db.vehicles.toArray(), []) ?? [];
  const customerMap = new Map<string, Customer>(customers.map((c) => [c.id, c]));
  const vehicleMap = new Map<string, Vehicle>(vehicles.map((v) => [v.id, v]));
  return { customers, vehicles, customerMap, vehicleMap };
}

/**
 * Saves `value` shortly after it changes, and immediately when leaving the screen or when the
 * phone locks / the app goes to the background, so a quick tap-and-go never loses a change.
 * Skips the initial load (and the first value after `key` changes), so merely opening a screen
 * never overwrites newer changes made on another device. Returns whether everything is saved.
 */
export function useAutosave<T>(value: T | null | undefined, save: (v: T) => unknown, key?: unknown, delay = 400) {
  const st = useRef<{ key: unknown; seen: boolean; pending: T | null }>({ key, seen: false, pending: null });
  const saveRef = useRef(save);
  saveRef.current = save;
  const [saved, setSaved] = useState(true);

  const flush = useCallback(() => {
    const p = st.current.pending;
    if (p == null) return;
    st.current.pending = null;
    void Promise.resolve(saveRef.current(p)).then(() => {
      if (st.current.pending == null) setSaved(true);
    });
  }, []);

  useEffect(() => {
    if (value == null) return;
    if (st.current.key !== key) {
      flush();
      st.current = { key, seen: false, pending: null };
    }
    if (!st.current.seen) {
      st.current.seen = true;
      return;
    }
    st.current.pending = value;
    setSaved(false);
    const t = setTimeout(flush, delay);
    return () => clearTimeout(t);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush(); // leaving the screen
    };
  }, [flush]);

  return saved;
}
