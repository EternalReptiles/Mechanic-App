import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import JobPage from './pages/JobPage';
import Schedule from './pages/Schedule';
import Customers from './pages/Customers';
import CustomerPage from './pages/CustomerPage';
import SettingsPage from './pages/SettingsPage';
import DocumentView from './pages/DocumentView';
import PriceList from './pages/PriceList';
import Reminders from './pages/Reminders';

const NAV = [
  { to: '/', label: 'Home', icon: '⌂', end: true },
  { to: '/jobs', label: 'Jobs', icon: '🔧' },
  { to: '/schedule', label: 'Schedule', icon: '📅' },
  { to: '/customers', label: 'Customers', icon: '👤' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export default function App() {
  return (
    <Routes>
      <Route path="/jobs/:id/:docType" element={<DocumentView />} />
      <Route
        path="*"
        element={
          <div className="shell">
            <main className="content">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/jobs" element={<Jobs />} />
                <Route path="/jobs/:id" element={<JobPage />} />
                <Route path="/schedule" element={<Schedule />} />
                <Route path="/customers" element={<Customers />} />
                <Route path="/customers/:id" element={<CustomerPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/settings/price-list" element={<PriceList />} />
                <Route path="/reminders" element={<Reminders />} />
              </Routes>
            </main>
            <nav className="bottom-nav">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end}>
                  <span className="nav-icon">{n.icon}</span>
                  <span>{n.label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
        }
      />
    </Routes>
  );
}
