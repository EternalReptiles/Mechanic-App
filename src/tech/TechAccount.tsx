import { useCloud } from '../cloud/CloudProvider';
import SyncBadge from '../cloud/SyncBadge';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import { exitTechPreview, isTechPreview } from './preview';

export default function TechAccount() {
  const cloud = useCloud();
  return (
    <>
      <PageHeader title="Account" />
      <section className="card">
        <p style={{ marginTop: 0 }}>
          <strong>{cloud.memberName(cloud.userId) || cloud.email}</strong><br />
          <span className="small muted">{cloud.email} · Technician at {cloud.businessName}</span>
        </p>
        <SyncBadge detailed />
        <div className="row wrap" style={{ marginTop: 12 }}>
          <Link className="btn" to="/timesheets">⏱ My hours</Link>
          {isTechPreview() ? (
            <button className="btn primary" onClick={exitTechPreview}>Exit technician preview</button>
          ) : (
            <button className="btn ghost" onClick={() => void cloud.signOut()}>Sign out</button>
          )}
        </div>
      </section>
    </>
  );
}
