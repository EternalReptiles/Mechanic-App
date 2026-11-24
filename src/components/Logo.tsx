/** The Spannr symbol: an "S" built from the angles of a hex nut. Uses the current text colour. */
export function SpannrSymbol({ size = 24, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="112 110 288 292" aria-hidden="true">
      <polyline
        points="342,150 206,150 152,206 206,256 306,256 360,306 306,362 170,362"
        fill="none"
        stroke={color}
        strokeWidth="60"
        strokeLinejoin="miter"
        strokeMiterlimit={4}
        strokeLinecap="square"
      />
    </svg>
  );
}
