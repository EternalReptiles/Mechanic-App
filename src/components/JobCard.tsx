import { Link } from 'react-router-dom';
import type { Customer, Job, Vehicle } from '../types';
import { useCloud } from '../cloud/CloudProvider';
import { fmtDateTime, money, totals, vehicleLabel } from '../utils';
import { StatusBadge } from './ui';

export default function JobCard({
  job,
  customer,
  vehicle,
  gst,
  showTime = true,
}: {
  job: Job;
  customer?: Customer;
  vehicle?: Vehicle;
  gst: boolean;
  showTime?: boolean;
}) {
  const t = totals(job.lineItems, gst);
  const { memberName } = useCloud();
  const tech = memberName(job.assignedTo);
  return (
    <Link to={`/jobs/${job.id}`} className="card job-card">
      <div className="row between">
        <strong>
          #{job.number} {customer?.name || 'No customer'}
        </strong>
        <StatusBadge status={job.status} />
      </div>
      {job.title && <div>{job.title}</div>}
      {vehicle && <div className="muted">{vehicleLabel(vehicle)}</div>}
      {(job.location === 'workshop' || tech) && (
        <div className="small muted">
          {[job.location === 'workshop' && `🔧 Workshop${job.keyTag ? ` · 🔑 ${job.keyTag}` : ''}`, tech && `👤 ${tech}`].filter(Boolean).join(' · ')}
        </div>
      )}
      <div className="row between muted small">
        <span>
          {showTime
            ? job.location === 'workshop' && job.promisedAt && !job.collectedAt
              ? `Ready by ${fmtDateTime(job.promisedAt)}`
              : fmtDateTime(job.scheduledStart)
            : job.siteAddress}
        </span>
        {t.total > 0 && <span>{money(t.total)}</span>}
      </div>
    </Link>
  );
}
