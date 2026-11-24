import { ClipboardList, UserRound } from 'lucide-react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { SpannrSymbol } from '../components/Logo';
import Compose from '../walkaround/Compose';
import TechAccount from './TechAccount';
import TechJob from './TechJob';
import TechMyJobs from './TechMyJobs';
import { exitTechPreview, isTechPreview } from './preview';

/** The technician's app: their jobs and what they need to do them – no prices, invoices or takings. */
export default function TechApp() {
  return (
    <Routes>
      <Route path="/jobs/:id/video" element={<Compose />} />
      <Route
        path="*"
        element={
          <div className="shell">
            {isTechPreview() && (
              <div className="preview-bar">
                Technician preview <button className="link" onClick={exitTechPreview}>Exit</button>
              </div>
            )}
            <main className="content">
              <Routes>
                <Route path="/" element={<TechMyJobs />} />
                <Route path="/jobs/:id" element={<TechJob />} />
                <Route path="/account" element={<TechAccount />} />
                <Route path="*" element={<TechMyJobs />} />
              </Routes>
            </main>
            <nav className="bottom-nav">
              <div className="side-brand"><SpannrSymbol size={22} color="#f59e0b" /> <span>Spannr</span></div>
              <NavLink to="/" end><span className="nav-icon"><ClipboardList size={22} /></span><span>My jobs</span></NavLink>
              <NavLink to="/account"><span className="nav-icon"><UserRound size={22} /></span><span>Account</span></NavLink>
            </nav>
          </div>
        }
      />
    </Routes>
  );
}
