import { useCallback, useEffect, useState } from 'react';
import { useCloud, type Role } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import { Empty, Field, PageHeader } from '../components/ui';

interface Member { user_id: string; email: string; role: Role }
interface Invite { email: string; role: Role }

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', tech: 'Technician' };
const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including the business account.',
  admin: 'Everything: jobs, money, settings and team.',
  tech: 'Jobs, customers, inspections and photos. No business settings or takings.',
};

export default function Team() {
  const { businessId, businessName, userId, isAdmin } = useCloud();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('tech');
  const [err, setErr] = useState('');
  const [justInvited, setJustInvited] = useState('');

  const load = useCallback(async () => {
    const [m, i] = await Promise.all([
      supabase.from('members').select('user_id, email, role').eq('business_id', businessId).order('created_at'),
      isAdmin ? supabase.from('invites').select('email, role').eq('business_id', businessId).order('created_at') : Promise.resolve({ data: [], error: null }),
    ]);
    if (m.error || i.error) setErr((m.error ?? i.error)!.message);
    setMembers((m.data ?? []) as Member[]);
    setInvites((i.data ?? []) as Invite[]);
  }, [businessId, isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const clean = email.trim().toLowerCase();
    const { error } = await supabase.from('invites').upsert({ business_id: businessId, email: clean, role });
    if (error) return setErr(error.message);
    setJustInvited(clean);
    setEmail('');
    void load();
  }

  const shareText = (to: string) =>
    `Hi! I've added you to ${businessName} on Spannr. Open ${window.location.origin} on your phone, tap "Create an account" and sign up with ${to} – you'll be straight in. Tip: use "Add to Home Screen" so it works like an app.`;

  return (
    <>
      <PageHeader back title="Team" />
      {err && <p className="error">{err}</p>}

      <h2>People</h2>
      {members.map((m) => (
        <div key={m.user_id} className="card row between">
          <div>
            <strong>{m.email}{m.user_id === userId && ' (you)'}</strong>
            <div className="muted small">{ROLE_LABEL[m.role]}</div>
          </div>
          {isAdmin && m.role !== 'owner' && m.user_id !== userId && (
            <div className="row">
              <select value={m.role} onChange={async (e) => {
                const { error } = await supabase.from('members').update({ role: e.target.value }).eq('business_id', businessId).eq('user_id', m.user_id);
                if (error) setErr(error.message);
                void load();
              }}>
                <option value="admin">Admin</option>
                <option value="tech">Technician</option>
              </select>
              <button className="icon-btn danger" aria-label={`Remove ${m.email}`} onClick={async () => {
                if (!confirm(`Remove ${m.email} from ${businessName}? They'll lose access straight away.`)) return;
                const { error } = await supabase.from('members').delete().eq('business_id', businessId).eq('user_id', m.user_id);
                if (error) setErr(error.message);
                void load();
              }}>✕</button>
            </div>
          )}
        </div>
      ))}

      {isAdmin && (
        <>
          <h2>Invited – waiting to sign up</h2>
          {invites.length ? invites.map((i) => (
            <div key={i.email} className="card row between">
              <div>
                <strong>{i.email}</strong>
                <div className="muted small">{ROLE_LABEL[i.role]}</div>
              </div>
              <div className="row">
                <a className="btn" href={`sms:?&body=${encodeURIComponent(shareText(i.email))}`}>💬 Text</a>
                <button className="icon-btn danger" aria-label={`Cancel invite for ${i.email}`} onClick={async () => {
                  await supabase.from('invites').delete().eq('business_id', businessId).eq('email', i.email);
                  void load();
                }}>✕</button>
              </div>
            </div>
          )) : <Empty>No pending invites.</Empty>}

          <form className="card grid" onSubmit={invite}>
            <h2 className="wide">Add a team member</h2>
            <Field label="Their email"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Role">
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="tech">Technician</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <p className="wide muted small" style={{ margin: 0 }}>{ROLE_HELP[role]}</p>
            <button className="btn primary wide">Add to team</button>
          </form>
          {justInvited && (
            <div className="banner">
              <span>Added {justInvited}. Send them the sign-up link:</span>
              <a className="btn primary" href={`sms:?&body=${encodeURIComponent(shareText(justInvited))}`}>💬 Text link</a>
            </div>
          )}
        </>
      )}
    </>
  );
}
