import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearLocalData, db, getMeta, getSettings, markAllDirty, setMeta, WORKSHOP_REMINDER, WORKSHOP_TERMS_EXTRA } from '../db';
import type { BusinessType } from '../types';
import { EMPTY_PLAN, planAllows, type EffectivePlan, type Feature, type PlanInfo } from '../plans';
import { personName } from '../utils';
import { supabase, withTimeout } from './supabase';
import { pendingCount, startSync, stopSync, syncNow } from './sync';
import NumberInput from '../components/NumberInput';
import { APP_URL } from '../native';

export type Role = 'owner' | 'admin' | 'tech';

export interface Membership {
  userId: string;
  email: string;
  businessId: string;
  businessName: string;
  role: Role;
}

export interface TeamMember {
  userId: string;
  email: string;
  name: string;
  role: Role;
}

interface CloudCtx extends Membership {
  isAdmin: boolean;
  team: TeamMember[];
  memberName: (userId?: string) => string;
  plan: PlanInfo;
  can: (feature: Feature) => boolean;
  refreshPlan: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<CloudCtx | null>(null);
export function useCloud(): CloudCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCloud outside CloudProvider');
  return c;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'recovery' }
  | { kind: 'noBusiness'; userId: string; email: string }
  | { kind: 'ready'; m: Membership };

/** Picks the business for this user, and makes sure this device's data belongs to it. */
async function resolveMembership(session: Session): Promise<Membership | null> {
  const userId = session.user.id;
  const email = session.user.email ?? '';
  try {
    await withTimeout(supabase.rpc('claim_invites'), 8000);
    const { data, error } = await withTimeout(
      supabase.from('members').select('business_id, role, businesses(name)').eq('user_id', userId),
      8000,
    );
    if (error) throw error;
    const rows = (data ?? []) as unknown as { business_id: string; role: Role; businesses: { name: string } | null }[];
    if (!rows.length) return null;
    const preferred = await getMeta<string>('businessId');
    const row = rows.find((r) => r.business_id === preferred) ?? rows[0];
    const m: Membership = { userId, email, businessId: row.business_id, businessName: row.businesses?.name ?? '', role: row.role };
    await setMeta('membership', m);
    return m;
  } catch (e) {
    // Offline: carry on with the last known membership so the app still works without signal.
    const cached = await getMeta<Membership>('membership');
    if (cached && cached.userId === userId) return cached;
    throw e;
  }
}

/** Makes sure local data on this device belongs to `businessId`. */
async function adoptDevice(businessId: string, justCreated: boolean) {
  const localBid = await getMeta<string>('businessId');
  if (localBid === businessId) return;
  if (localBid) {
    await clearLocalData(); // data from another business
  } else if (justCreated) {
    await markAllDirty(); // first business on this device: upload what's already here
  } else {
    const [customers, jobs] = await Promise.all([db.customers.count(), db.jobs.count()]);
    const keep =
      (customers || jobs) &&
      confirm(`This device has ${customers} customers and ${jobs} jobs saved before you signed in. Upload them to this business?`);
    if (keep) await markAllDirty();
    else await clearLocalData();
  }
  await setMeta('businessId', businessId);
}

export default function CloudProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [error, setError] = useState('');

  const enter = useCallback(async (session: Session | null, justCreated = false) => {
    setError('');
    if (!session) {
      // Signed-out but offline with a cached membership? Let them keep working.
      const cached = await getMeta<Membership>('membership');
      if (cached && !navigator.onLine) return setPhase({ kind: 'ready', m: cached });
      return setPhase({ kind: 'signedOut' });
    }
    try {
      const m = await resolveMembership(session);
      if (!m) return setPhase({ kind: 'noBusiness', userId: session.user.id, email: session.user.email ?? '' });
      await adoptDevice(m.businessId, justCreated);
      setPhase({ kind: 'ready', m });
    } catch (e) {
      setError((e as Error).message);
      setPhase({ kind: 'noBusiness', userId: session.user.id, email: session.user.email ?? '' });
    }
  }, []);

  useEffect(() => {
    let current: string | null = null;
    // Defer work out of the auth callback: calling Supabase inside it can deadlock.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const id = session?.user.id ?? null;
      if (event === 'PASSWORD_RECOVERY') return void setTimeout(() => setPhase({ kind: 'recovery' }), 0);
      if (event === 'INITIAL_SESSION' || (event === 'SIGNED_IN' && id !== current)) {
        current = id;
        setTimeout(() => void enter(session), 0);
      } else if (event === 'SIGNED_OUT') {
        current = null;
        setTimeout(() => setPhase({ kind: 'signedOut' }), 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [enter]);

  const ready = phase.kind === 'ready' ? phase.m : null;
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [plan, setPlan] = useState<PlanInfo>(EMPTY_PLAN);
  const refreshPlan = useCallback(async () => {
    if (!ready) return;
    const [{ data: b }, { data: eff }] = await Promise.all([
      supabase.from('businesses')
        .select('plan, plan_status, plan_interval, trial_ends_at, current_period_end, cancel_at_period_end, complimentary')
        .eq('id', ready.businessId).maybeSingle(),
      supabase.rpc('business_plan', { bid: ready.businessId }),
    ]);
    if (!b || !eff) return;
    const p: PlanInfo = {
      effective: eff as EffectivePlan,
      plan: b.plan,
      status: b.plan_status,
      interval: b.plan_interval,
      trialEndsAt: b.trial_ends_at,
      periodEnd: b.current_period_end,
      cancelAtPeriodEnd: !!b.cancel_at_period_end,
      complimentary: !!b.complimentary,
    };
    setPlan(p);
    void setMeta('plan', p);
  }, [ready?.businessId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready) return;
    startSync(ready.businessId);
    // Plan (cached so it works offline), then refreshed from the server.
    getMeta<PlanInfo>('plan').then((p) => p && setPlan(p));
    void refreshPlan();
    // Team list for assigning jobs; cached so it works offline.
    getMeta<TeamMember[]>('team').then((t) => t && setTeam(t));
    supabase
      .from('members')
      .select('user_id, email, name, role')
      .eq('business_id', ready.businessId)
      .order('created_at')
      .then(({ data }) => {
        if (!data) return;
        const t = data.map((r) => ({ userId: r.user_id, email: r.email, name: personName(r.email, r.name), role: r.role as Role }));
        setTeam(t);
        void setMeta('team', t);
      });
    return () => stopSync();
  }, [ready?.businessId]); // eslint-disable-line react-hooks/exhaustive-deps
  const memberName = useCallback(
    (userId?: string) => (userId ? team.find((t) => t.userId === userId)?.name ?? 'Former staff' : ''),
    [team],
  );

  const signOut = useCallback(async () => {
    await syncNow();
    const n = await pendingCount();
    if (n && !confirm(`${n} change(s) haven't uploaded yet (no signal?). Signing out will lose them. Sign out anyway?`)) return;
    stopSync();
    await clearLocalData();
    await supabase.auth.signOut({ scope: 'local' });
    setPhase({ kind: 'signedOut' });
  }, []);

  if (phase.kind === 'loading')
    return (
      <div className="auth-wrap loading-screen">
        <img src="/icon.svg" alt="Spannr" width={72} height={72} />
        <p className="muted">Loading…</p>
      </div>
    );
  if (phase.kind === 'signedOut') return <SignIn />;
  if (phase.kind === 'recovery') return <NewPassword onDone={() => supabase.auth.getSession().then(({ data }) => enter(data.session))} />;
  if (phase.kind === 'noBusiness')
    return (
      <NoBusiness
        email={phase.email}
        error={error}
        onCreated={async () => enter((await supabase.auth.getSession()).data.session, true)}
        onRetry={async () => enter((await supabase.auth.getSession()).data.session)}
      />
    );

  const m = phase.m;
  return (
    <Ctx.Provider
      value={{ ...m, isAdmin: m.role === 'owner' || m.role === 'admin', signOut, team, memberName, plan, refreshPlan, can: (f) => planAllows(plan.effective, f) }}
    >
      {children}
    </Ctx.Provider>
  );
}

/**
 * Adjusts the sample price list for a new business: labour lines use their own rate, and
 * workshop-only businesses don't get a mobile call-out fee. Only touches the untouched samples.
 */
async function tailorStarterPriceList(type: BusinessType, rate: number) {
  const items = await db.catalog.toArray();
  for (const item of items) {
    if (type === 'workshop' && item.name === 'Call-out fee') {
      await db.catalog.delete(item.id); // never synced yet, so no tombstone needed
      continue;
    }
    const lines = item.lines.map((l) => (l.type === 'labour' && l.unitPrice === 120 ? { ...l, unitPrice: rate } : l));
    await db.catalog.put({ ...item, lines });
  }
}

// ---------- Screens ----------

function Brand() {
  return (
    <div className="auth-brand">
      <img src="/icon.svg" alt="" width={56} height={56} />
      <h1>Spannr</h1>
      <p className="muted">Jobs, quotes, sign-offs &amp; invoices for mechanics</p>
    </div>
  );
}

function SignIn() {
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'up') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: APP_URL },
        });
        if (error) throw error;
        if (!data.session) setMsg(`Nearly there! We've emailed a confirmation link to ${email}. Tap it, then sign in here.`);
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: APP_URL });
        if (error) throw error;
        setMsg(`If ${email} has an account, a password reset link is on its way.`);
      }
    } catch (e) {
      setErr(friendly((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <Brand />
      <form className="card auth-card" onSubmit={submit}>
        <h2>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create your account' : 'Reset password'}</h2>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== 'forgot' && (
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} required minLength={8}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        {err && <p className="error">{err}</p>}
        {msg && <p className="notice">{msg}</p>}
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}
        </button>
        {mode === 'up' && (
          <p className="small muted" style={{ textAlign: 'center', margin: '4px 0 0' }}>
            By creating an account you agree to the{' '}
            <a href="https://spannr.au/terms" target="_blank" rel="noreferrer">Terms of Service</a> and{' '}
            <a href="https://spannr.au/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.
          </p>
        )}
        <div className="auth-links">
          {mode !== 'in' && <button type="button" className="link" onClick={() => setMode('in')}>I have an account – sign in</button>}
          {mode !== 'up' && <button type="button" className="link" onClick={() => setMode('up')}>New here? Create an account</button>}
          {mode === 'in' && <button type="button" className="link" onClick={() => setMode('forgot')}>Forgot password?</button>}
        </div>
      </form>
    </div>
  );
}

function friendly(m: string) {
  if (/invalid login/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'Please confirm your email first – check your inbox for the link.';
  if (/rate limit/i.test(m)) return 'Too many emails sent recently. Please try again in a little while.';
  if (/fetch|network/i.test(m)) return "Can't reach the server. Check your signal and try again.";
  return m;
}

function NewPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="auth-wrap">
      <Brand />
      <form className="card auth-card" onSubmit={async (e) => {
        e.preventDefault();
        const { error } = await supabase.auth.updateUser({ password });
        if (error) setErr(friendly(error.message));
        else onDone();
      }}>
        <h2>Choose a new password</h2>
        <label className="field">
          <span>New password</span>
          <input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <p className="error">{err}</p>}
        <button className="btn primary block">Save password</button>
      </form>
    </div>
  );
}

function NoBusiness({ email, error, onCreated, onRetry }: { email: string; error: string; onCreated: () => void; onRetry: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<BusinessType>('mobile');
  const [rate, setRate] = useState(120);
  const [gst, setGst] = useState(true);
  const [abn, setAbn] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(error);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const { error } = await supabase.rpc('create_business', { p_name: name });
    if (error) {
      setErr(friendly(error.message));
      setBusy(false);
      return;
    }
    // Set the account up for how they work, so quotes and invoices are right from the first job.
    const s = await getSettings();
    await db.settings.put({
      ...s,
      businessName: name.trim() || s.businessName,
      email: s.email || email,
      abn: abn.trim() || s.abn,
      businessType: type,
      labourRate: rate || s.labourRate,
      gstRegistered: gst,
      reminderMessage: type === 'mobile' ? s.reminderMessage : WORKSHOP_REMINDER,
      terms: type === 'mobile' ? s.terms : s.terms + WORKSHOP_TERMS_EXTRA,
    });
    await tailorStarterPriceList(type, rate || s.labourRate);
    onCreated();
  }

  return (
    <div className="auth-wrap">
      <Brand />
      <form className="card auth-card" onSubmit={create}>
        <h2>Set up your business</h2>
        <p className="muted small">Signed in as {email}.</p>
        <label className="field">
          <span>Business name</span>
          <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Smith's Mobile Mechanics" />
        </label>
        <div className="field">
          <span>How do you work?</span>
          <div className="choice">
            {([
              ['mobile', '🚐 Mobile', 'I go to the customer'],
              ['workshop', '🔧 Workshop', 'Customers bring the car to me'],
              ['both', '🚐🔧 Both', 'Workshop and mobile jobs'],
            ] as const).map(([v, label, help]) => (
              <button type="button" key={v} className={type === v ? 'on' : ''} onClick={() => setType(v)}>
                <strong>{label}</strong>
                <span className="small muted">{help}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid">
          <label className="field">
            <span>Hourly labour rate (ex GST)</span>
            <NumberInput min={0} required placeholder="" value={rate} onChange={setRate} />
          </label>
          <label className="field">
            <span>ABN (optional)</span>
            <input inputMode="numeric" value={abn} onChange={(e) => setAbn(e.target.value)} />
          </label>
        </div>
        <label className="field checkbox">
          <input type="checkbox" checked={gst} onChange={(e) => setGst(e.target.checked)} />
          <span>Registered for GST (adds 10% to quotes &amp; invoices)</span>
        </label>
        <p className="muted small" style={{ margin: 0 }}>You can change all of this later in Settings.</p>
        {err && <p className="error">{err}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Creating…' : 'Create business'}</button>
      </form>
      <div className="card auth-card">
        <h2>Joining a team?</h2>
        <p className="small">
          Ask the business owner to add <strong>{email}</strong> under Settings → Team, then tap the button below.
        </p>
        <button className="btn block" onClick={onRetry}>I've been added – check again</button>
      </div>
      <button className="link" onClick={() => supabase.auth.signOut({ scope: 'local' })}>Sign out</button>
    </div>
  );
}
