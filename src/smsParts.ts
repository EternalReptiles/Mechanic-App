// Mirrors public.sms_final_body / sms_part_count in the database, so the app can show "≈ 2 texts" while typing.
const GSM = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const EXT = '^{}\\[~]|€';

/** Plain punctuation and short links, as the server does before sending (public.sms_tidy). */
export function smsTidy(t: string) {
  return t
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2010\u2011\u2012\u2212]/g, '-').replace(/[\u00A0\u202F]/g, ' ')
    .replace(/\u2026/g, '...').replace(/\u2022/g, '-')
    .replace(/https?:\/\/\S+/g, (u) => (u.length > 40 ? 'https://spannr.au/r/xxxxxxxxxx' : u));
}

export function smsFinalBody(biz: string, kind: string, body: string) {
  body = smsTidy(body);
  let t = biz && !body.toLowerCase().includes(biz.toLowerCase()) ? `${biz}: ${body}` : body;
  if (kind === 'confirmation' || kind === 'reminder') t += '\nReply Y to confirm, C to cancel.';
  return t;
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
