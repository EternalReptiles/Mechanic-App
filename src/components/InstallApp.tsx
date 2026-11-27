import { useEffect, useState } from 'react';
import { isNative } from '../native';

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: PromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as PromptEvent;
    listeners.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((f) => f());
  });
}

const installed = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const isIOS = /iPhone|iPad|iPod/.test(ua);
const isMacSafari = /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Edg|Firefox/.test(ua);
const isFirefox = /Firefox/.test(ua);

/** "Install Spannr" – puts the web app on a computer's desktop/dock (or phone home screen) as its own app. */
export default function InstallApp({ compact = false }: { compact?: boolean }) {
  const [, force] = useState(0);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    listeners.add(f);
    return () => void listeners.delete(f);
  }, []);
  if (isNative || installed()) return null;

  async function install() {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice.catch(() => undefined);
      deferred = null;
      force((n) => n + 1);
    } else setHelp(true);
  }

  const howTo = isIOS
    ? 'In Safari, tap the Share button, then "Add to Home Screen".'
    : isMacSafari
      ? 'In Safari, choose File → Add to Dock.'
      : isFirefox
        ? 'Firefox can\'t install web apps – open app.spannr.au in Chrome or Edge, then use the install button in the address bar.'
        : 'In Chrome or Edge, click the install icon at the right of the address bar (or the ⋮ menu → "Install Spannr").';

  return (
    <div className={compact ? 'install-app compact' : 'install-app card'}>
      {!compact && (
        <>
          <h2 style={{ marginTop: 0 }}>💻 Install Spannr on this computer</h2>
          <p className="small muted" style={{ marginTop: 0 }}>
            Opens in its own window from your desktop, dock or Start menu – no browser tabs. Updates itself automatically.
          </p>
        </>
      )}
      <button className={`btn ${compact ? 'small' : 'primary'}`} onClick={() => void install()}>⬇ Install Spannr</button>
      {help && <p className="small" style={{ marginBottom: 0 }}>{howTo}</p>}
    </div>
  );
}
