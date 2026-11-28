import { useCallback, useEffect, useState } from 'react';
import { useCloud, type Role } from '../cloud/CloudProvider';
import { supabase } from '../cloud/supabase';
import { Empty, Field, PageHeader } from '../components/ui';
import { PLANS } from '../plans';
import { APP_URL } from '../native';
import { personName } from '../utils';

interface Member { user_id: string; email: string; role: Role; name: string | null }
interface Invite { email: string; role: Role; name: string | null }

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', tech: 'Technician' };
const ROLE_HELP: Record<Role, string> = {
  owner: 'Everything, including the business account.',
  admin: 'Everything: jobs, money, settings and team.',
  tech: 'Jobs, customers, inspections and photos. No business settings or takings.',
};

export default function Team() {
  const { businessId, businessName, userId, isAdmin, plan, refreshTeam } = useCloud();
  const limit = plan.effective === 'trial' || plan.effective === 'expired' ? null : PLANS[plan.effective].users;
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('tech');
  const [err, setErr] = useState('');
  const [justInvited, setJustInvited] = useState('');

  const load = useCallback(async () => {
    const [m, i] = await Promise.all([
      supabase.from('members').select('user_id, email, role, name').eq('business_id', businessId).order('created_at'),
      isAdmin ? supabase.from('invites').select('email, role, name').eq('business_id', businessId).order('created_at') : Promise.resolve({ data: [], error: null }),
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
    const { error } = await supabase.from('invites').upsert({ business_id: businessId, email: clean, role, name: name.trim() || null });
    if (error)
      return setErr(/row-level security/i.test(error.message)
        ? `Your plan includes ${limit ?? 'a limited number of'} user${limit === 1 ? '' : 's'}. Upgrade in Settings → Plan & billing to add more.`
        : error.message);
    setJustInvited(clean);
    setEmail('');
    setName('');
    void load();
  }

  const shareText = (to: string) =>
    `Hi! I've added you to ${businessName} on Spannr. Open ${APP_URL} on your phone, tap "Create an account" and sign up with ${to} – you'll be straight in. Tip: use "Add to Home Screen" so it works like an app.`;

  return (
    <>
      <PageHeader back title="Team" />
      {err && <p className="error">{err}</p>}

      <h2>People {limit && <span className="muted small">({members.length + invites.length} of {limit} on your plan)</span>}</h2>
      {members.map((m) => (
        <div key={m.user_id} className="card row between">
          <div>
            <strong>{personName(m.email, m.name ?? '')}{m.user_id === userId && ' (you)'}</strong>
            <div className="muted small">{m.email} · {ROLE_LABEL[m.role]}</div>
            {(isAdmin || m.user_id === userId) && (
              <button className="link small" style={{ padding: 0 }} onClick={async () => {
                const name = prompt(`Name for ${m.email} (shown on jobs, timesheets and texts):`, personName(m.email, m.name ?? ''));
                if (name === null) return;
                const { error } = await supabase.rpc('set_member_name', { bid: businessId, uid: m.user_id, p_name: name });
                if (error) setErr(error.message);
                void load();
                void refreshTeam();
              }}>✏️ Change name</button>
            )}
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
                <strong>{i.name || i.email}</strong>
                <div className="muted small">{i.name ? `${i.email} · ` : ''}{ROLE_LABEL[i.role]}</div>
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
            <Field label="Their name"><input required autoComplete="off" value={name} placeholder="e.g. Lachie Bancroft" onChange={(e) => setName(e.target.value)} /></Field>
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
