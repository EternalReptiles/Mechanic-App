// Mirrors public.sms_final_body / sms_part_count in the database, so the app can show "≈ 2 texts" while typing.
const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const EXT = '^{}\\[~]|€';

export function smsFinalBody(biz: string, kind: string, body: string) {
  let t = biz && !body.toLowerCase().includes(biz.toLowerCase()) ? `${biz}: ${body}` : body;
  if (kind === 'confirmation' || kind === 'reminder') t += '\nReply Y to confirm or C to cancel.';
  return `${t}\n- Powered by Spannr`;
}

export function smsParts(t: string) {
  let n = 0;
  for (const c of t) {
    if (GSM.includes(c)) n += 1;
    else if (EXT.includes(c)) n += 2;
    else {
      const u = t.length; // UTF-16 length: emoji count as 2, like the network does
      return u <= 70 ? 1 : Math.ceil(u / 67);
    }
  }
  return n <= 160 ? 1 : Math.ceil(n / 153);
}

/** "≈ 2 texts" for a message the business is about to send. */
export const textsFor = (biz: string, kind: string, body: string) => smsParts(smsFinalBody(biz.trim(), kind, body.trim()));
