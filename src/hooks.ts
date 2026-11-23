import { useLiveQuery } from 'dexie-react-hooks';
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
