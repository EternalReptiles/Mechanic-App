import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCloud } from '../cloud/CloudProvider';
import { useLookups, useSettings } from '../hooks';
import type { Job } from '../types';
import { fmtDateTime, money, totals, vehicleLabel } from '../utils';
import { StatusBadge } from './ui';

type SortKey = 'number' | 'customer' | 'vehicle' | 'status' | 'booked' | 'tech' | 'total';

/** Desktop job list: sortable columns, click a row to open the job. */
export default function JobsTable({ jobs }: { jobs: Job[] }) {
  const navigate = useNavigate();
  const settings = useSettings();
  const { customerMap, vehicleMap } = useLookups();
  const { memberName } = useCloud();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'number', dir: -1 });

  const rows = jobs.map((j) => {
    const c = customerMap.get(j.customerId);
    const v = vehicleMap.get(j.vehicleId);
    return {
      j,
      number: j.number,
      customer: c?.name ?? '',
      vehicle: vehicleLabel(v),
      status: j.status,
      booked: j.scheduledStart || '',
      tech: memberName(j.assignedTo),
      total: totals(j.lineItems, settings.gstRegistered).total,
    };
  });
  rows.sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
  });
  const th = (key: SortKey, label: string, right = false) => (
    <th className={right ? 'num' : ''}>
      <button className="th-sort" onClick={() => setSort({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : 1 })}>
        {label} {sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}
      </button>
    </th>
  );

  return (
    <div className="card table-card">
      <table className="data-table">
        <thead>
          <tr>{th('number', '#')}{th('customer', 'Customer')}{th('vehicle', 'Vehicle')}<th>Job</th>{th('status', 'Status')}{th('booked', 'Booked')}{th('tech', 'Technician')}{th('total', 'Total', true)}</tr>
        </thead>
        <tbody>
          {rows.map(({ j, customer, vehicle, booked, tech, total }) => (
            <tr key={j.id} onClick={() => navigate(`/jobs/${j.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/jobs/${j.id}`)}>
              <td>{j.number}</td>
              <td><strong>{customer || '—'}</strong></td>
              <td>{vehicle || '—'}</td>
              <td className="ellipsis">{j.title || '—'}</td>
              <td><StatusBadge status={j.status} /></td>
              <td className="nowrap">{booked ? fmtDateTime(booked) : '—'}</td>
              <td>{tech || '—'}</td>
              <td className="num">{total ? money(total) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
