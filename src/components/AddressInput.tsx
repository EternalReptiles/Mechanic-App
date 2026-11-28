import { useEffect, useRef, useState } from 'react';
import { supabase } from '../cloud/supabase';

/**
 * An address box that suggests real addresses as you type (Google Places, through our server).
 * Works as a plain text box when offline or when nothing matches – typing is never blocked.
 */
export default function AddressInput({ value, onChange, placeholder, required, id, autoComplete = 'street-address' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; id?: string; autoComplete?: string;
}) {
  const [list, setList] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const typed = useRef(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!typed.current || value.trim().length < 4 || !navigator.onLine) { setList([]); return; }
    const n = ++seq.current;
    const t = window.setTimeout(() => {
      void supabase.functions.invoke('address-search', { body: { q: value } }).then(({ data }) => {
        if (n !== seq.current) return;
        const r = ((data as { results?: string[] } | null)?.results ?? []).filter((x) => x.toLowerCase() !== value.trim().toLowerCase());
        setList(r);
        setOpen(r.length > 0);
        setHi(-1);
      }, () => undefined);
    }, 350);
    return () => window.clearTimeout(t);
  }, [value]);

  const pick = (a: string) => { typed.current = false; onChange(a); setList([]); setOpen(false); };

  return (
    <div className="addr-box">
      <input id={id} value={value} placeholder={placeholder} required={required} autoComplete={autoComplete}
        onChange={(e) => { typed.current = true; onChange(e.target.value); }}
        onFocus={() => list.length && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(list.length - 1, h + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); pick(list[hi]); }
          else if (e.key === 'Escape') setOpen(false);
        }} />
      {open && (
        <ul className="addr-list" role="listbox">
          {list.map((a, i) => (
            <li key={a} role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''}
              onMouseDown={(e) => { e.preventDefault(); pick(a); }}>📍 {a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
