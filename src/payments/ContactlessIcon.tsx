/** Contactless symbol (four waves), as used for Tap to Pay. */
export default function ContactlessIcon({ size = 22, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M6.5 8.5a5 5 0 0 1 0 7" />
      <path d="M10 6a9 9 0 0 1 0 12" />
      <path d="M13.5 3.5a13 13 0 0 1 0 17" />
      <path d="M17 1.5a16 16 0 0 1 0 21" />
    </svg>
  );
}
