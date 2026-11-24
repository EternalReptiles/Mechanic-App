/** Lets an owner see exactly what technicians see (stored on this device only). */
const KEY = 'spannr-tech-preview';
export function isTechPreview(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
export function startTechPreview() {
  try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
  window.location.href = '/';
}
export function exitTechPreview() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  window.location.href = '/settings';
}
