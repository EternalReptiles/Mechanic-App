import { Link } from 'react-router-dom';
import { neededPlan, type Feature } from '../plans';

/** Shown in place of a feature the business's plan doesn't include. */
export default function Upgrade({ feature, what }: { feature: Feature; what: string }) {
  return (
    <div className="upgrade">
      <span>🔒 {what} is on the <strong>{neededPlan(feature)}</strong> plan and above.</span>
      <Link className="btn small" to="/settings/billing">See plans</Link>
    </div>
  );
}
