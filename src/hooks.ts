import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef } from 'react';
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
 * Saves `value` shortly after it changes. Skips the initial load, so merely opening a
 * screen never overwrites newer changes made on another device.
 */
export function useAutosave<T>(value: T | null | undefined, save: (v: T) => unknown, delay = 400) {
  const first = useRef<T | null | undefined>(undefined);
  useEffect(() => {
    if (value == null) return;
    if (first.current === undefined) {
      first.current = value;
      return;
    }
    const t = setTimeout(() => save(value), delay);
    return () => clearTimeout(t);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
}
