import { useEffect, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number | null | undefined;
  onChange: (n: number) => void;
};

const show = (n: number | null | undefined) => (n === null || n === undefined || n === 0 || Number.isNaN(n) ? '' : String(n));

/**
 * A number box that can be cleared while typing. A zero shows as an empty box (with a grey "0" placeholder),
 * so typing 85 gives 85 – not 085. An empty box counts as 0.
 */
export default function NumberInput({ value, onChange, placeholder = '0', inputMode = 'decimal', step = 'any', onFocus, ...rest }: Props) {
  const [text, setText] = useState(show(value));

  // Follow changes made elsewhere (e.g. picking a catalogue item) without fighting what's being typed.
  useEffect(() => {
    const typed = text === '' ? 0 : Number(text);
    if ((value ?? 0) !== typed) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      {...rest}
      type="number"
      inputMode={inputMode}
      step={step}
      placeholder={placeholder}
      value={text}
      onFocus={(e) => {
        e.target.select();
        onFocus?.(e);
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = e.target.valueAsNumber;
        onChange(Number.isNaN(n) ? 0 : n);
      }}
    />
  );
}
