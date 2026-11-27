// Daily: permanently deletes businesses that were closed more than 90 days ago (as promised in the Terms and
// Privacy Policy) – their files, all their data, and logins that no longer belong to any business.
// Called by pg_cron with the PURGE_TOKEN; not callable by app users.
import { admin } from '../_shared/stripe.ts';

const BUCKETS = ['photos', 'walkaround-videos'];

async function removeFolder(bucket: string, prefix: string) {
  for (;;) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error || !data?.length) return;
    const files = data.filter((f) => f.id).map((f) => `${prefix}/${f.name}`);
    const folders = data.filter((f) => !f.id).map((f) => `${prefix}/${f.name}`);
    for (const sub of folders) await removeFolder(bucket, sub);
    if (!files.length) return;
    await admin.storage.from(bucket).remove(files);
    if (data.length < 1000) return;
  }
}

Deno.serve(async (req) => {
  const token = Deno.env.get('PURGE_TOKEN');
  if (!token || req.headers.get('x-purge-token') !== token) return new Response('forbidden', { status: 403 });
  const { data: due, error } = await admin.rpc('businesses_due_for_deletion');
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const done: string[] = [];
  for (const { id } of (due ?? []) as { id: string }[]) {
    try {
      const { data: members } = await admin.from('members').select('user_id').eq('business_id', id);
      for (const b of BUCKETS) await removeFolder(b, id);
      const { error: delErr } = await admin.from('businesses').delete().eq('id', id);
      if (delErr) throw delErr;
      // Remove logins that now belong to no business (and aren't Spannr admins).
      for (const { user_id } of members ?? []) {
        const [{ count }, { data: adm }] = await Promise.all([
          admin.from('members').select('*', { count: 'exact', head: true }).eq('user_id', user_id),
          admin.from('spannr_admins').select('user_id').eq('user_id', user_id).maybeSingle(),
        ]);
        if (!count && !adm) await admin.auth.admin.deleteUser(user_id);
      }
      done.push(id);
    } catch (e) {
      console.error('purge failed for', id, e);
    }
  }
  return Response.json({ ok: true, deleted: done.length });
});
