import { useEffect, useRef, useState } from 'react';

const MAX_SECONDS = 180;

/** Preferred first: MP4 plays everywhere (incl. iPhones). Some browsers claim support but fail, so we try in order. */
function mimeCandidates(): string[] {
  const options = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const ok = options.filter((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
  return [...ok, '']; // '' = browser default
}

/**
 * Records with the phone's rear camera at a modest bitrate (~1.5 Mbps),
 * so a 2–3 minute walk-around stays small enough to send on mobile data.
 */
export default function VideoRecorder({ onDone, onCancel }: { onDone: (blob: Blob) => void; onCancel: () => void }) {
  const preview = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        setReady(true);
        if (preview.current) {
          preview.current.srcObject = s;
          void preview.current.play().catch(() => {});
        }
      })
      .catch((e: Error) =>
        setError(
          e.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow camera and microphone for this site in your phone settings, or use "Choose a video" instead.'
            : `Can't open the camera (${e.message}). Use "Choose a video" instead.`,
        ),
      );
    if (!navigator.mediaDevices) setError('This browser can\'t record video. Use "Choose a video" instead.');
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  useEffect(() => {
    if (recording && seconds >= MAX_SECONDS) stop();
  }, [seconds, recording]); // eslint-disable-line react-hooks/exhaustive-deps

  function start() {
    if (!stream.current) return;
    for (const mimeType of mimeCandidates()) {
      try {
        const r = new MediaRecorder(stream.current, {
          ...(mimeType ? { mimeType } : {}),
          videoBitsPerSecond: 1_500_000,
          audioBitsPerSecond: 64_000,
        });
        const parts: Blob[] = [];
        r.ondataavailable = (e) => e.data.size && parts.push(e.data);
        r.onstop = () => {
          const blob = new Blob(parts, { type: r.mimeType || mimeType || 'video/webm' });
          stream.current?.getTracks().forEach((t) => t.stop());
          onDone(blob);
        };
        r.start(1000);
        chunks.current = parts;
        recorder.current = r;
        setSeconds(0);
        setRecording(true);
        return;
      } catch {
        // try the next format
      }
    }
    setError('This phone can\'t record video in the app. Use "Choose a video" instead.');
  }

  function stop() {
    setRecording(false);
    recorder.current?.stop();
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div className="recorder">
      {error ? (
        <p className="error">{error}</p>
      ) : (
        <div className="recorder-view">
          <video ref={preview} muted playsInline />
          {recording && <span className="rec-dot">● REC {mmss} / 3:00</span>}
        </div>
      )}
      <div className="row wrap">
        {!error && !recording && (
          <button className="btn primary grow big" disabled={!ready} onClick={start}>{ready ? '● Start recording' : 'Opening camera…'}</button>
        )}
        {recording && <button className="btn danger grow big" onClick={stop}>■ Stop</button>}
        {!recording && <button className="btn ghost" onClick={onCancel}>Cancel</button>}
      </div>
      {!recording && !error && (
        <p className="muted small">Tip: walk around the car and talk through what you found. Keep it under 3 minutes.</p>
      )}
    </div>
  );
}
