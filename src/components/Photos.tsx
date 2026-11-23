import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../db';
import type { Photo } from '../types';
import { resizeImage, uid } from '../utils';

function Thumb({ photo }: { photo: Photo }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(photo.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo.blob]);
  return (
    <figure className="thumb">
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={photo.caption || 'Job photo'} />
      </a>
      <button
        className="icon-btn danger"
        aria-label="Delete photo"
        onClick={() => confirm('Delete this photo?') && db.photos.delete(photo.id)}
      >
        ✕
      </button>
    </figure>
  );
}

export default function Photos({ jobId }: { jobId: string }) {
  const photos = useLiveQuery(() => db.photos.where('jobId').equals(jobId).sortBy('createdAt'), [jobId]) ?? [];
  const [busy, setBusy] = useState(false);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        await db.photos.add({ id: uid(), jobId, blob: await resizeImage(f), caption: '', createdAt: new Date().toISOString() });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="thumbs">
        {photos.map((p) => <Thumb key={p.id} photo={p} />)}
      </div>
      <label className="btn">
        {busy ? 'Saving…' : '📷 Add photos'}
        <input type="file" accept="image/*" capture="environment" multiple hidden
          onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </label>
    </div>
  );
}
