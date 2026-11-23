import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import JobCard from '../components/JobCard';
import { Empty, PageHeader } from '../components/ui';
import { useCloud } from '../cloud/CloudProvider';
import { createJob, db } from '../db';
import { useLookups, useSettings } from '../hooks';
import type { JobStatus } from '../types';
import { STATUS, STATUS_ORDER } from '../utils';

export default function Jobs() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as JobStatus | null) ?? null;
  const mine = params.get('mine') === '1';
  const { userId, team } = useCloud();
  const [q, setQ] = useState('');
  const settings = useSettings();
  const { customerMap, vehicleMap } = useLookups();
  const jobs = useLiveQuery(() => db.jobs.reverse().sortBy('number'), []) ?? [];

  const needle = q.trim().toLowerCase();
  const filtered = jobs.filter((j) => {
    if (status ? j.status !== status : j.status === 'cancelled' || j.status === 'paid') return false;
    if (mine && j.assignedTo !== userId) return false;
    if (!needle) return true;
    const c = customerMap.get(j.customerId);
    const v = vehicleMap.get(j.vehicleId);
    return [String(j.number), j.title, j.description, j.siteAddress, c?.name, c?.phone, v?.rego, v?.make, v?.model]
      .filter(Boolean)
      .some((s) => s!.toLowerCase().includes(needle));
  });

  async function newJob() {
    const job = await createJob();
    navigate(`/jobs/${job.id}`);
  }

  return (
    <>
      <PageHeader title="Jobs" actions={<button className="btn primary" onClick={newJob}>+ New job</button>} />
      <input
        className="search"
        type="search"
        placeholder="Search name, rego, job #, address…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="chips">
        <button className={`chip${!status && !mine ? ' active' : ''}`} onClick={() => setParams({})}>
          All open
        </button>
        {team.length > 1 && (
          <button className={`chip${mine ? ' active' : ''}`} onClick={() => setParams({ mine: '1' })}>
            My jobs
          </button>
        )}
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            className={`chip${status === s ? ' active' : ''}`}
            style={status === s ? { background: STATUS[s].color, borderColor: STATUS[s].color } : undefined}
            onClick={() => setParams({ status: s })}
          >
            {STATUS[s].label}
          </button>
        ))}
      </div>
      {filtered.length ? (
        filtered.map((j) => (
          <JobCard key={j.id} job={j} customer={customerMap.get(j.customerId)} vehicle={vehicleMap.get(j.vehicleId)} gst={settings.gstRegistered} />
        ))
      ) : (
        <Empty>No jobs found.</Empty>
      )}
    </>
  );
}
