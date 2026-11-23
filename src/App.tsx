import { NavLink, Route, Routes } from 'react-router-dom';
import { useSettings } from './hooks';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import JobPage from './pages/JobPage';
import Schedule from './pages/Schedule';
import Customers from './pages/Customers';
import CustomerPage from './pages/CustomerPage';
import SettingsPage from './pages/SettingsPage';
import DocumentView from './pages/DocumentView';
import PriceList from './pages/PriceList';
import Team from './pages/Team';
import CloudProvider from './cloud/CloudProvider';
import Reminders from './pages/Reminders';

function BottomNav() {
  const { businessType } = useSettings();
  const nav = [
    { to: '/', label: 'Home', icon: '⌂', end: true },
    { to: '/jobs', label: 'Jobs', icon: '🔧' },
    businessType === 'workshop'
      ? { to: '/schedule', label: 'Workshop', icon: '🚗' }
      : { to: '/schedule', label: 'Schedule', icon: '📅' },
    { to: '/customers', label: 'Customers', icon: '👤' },
    { to: '/settings', label: 'Settings', icon: '⚙' },
  ];
  return (
    <nav className="bottom-nav">
      {nav.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end}>
          <span className="nav-icon">{n.icon}</span>
          <span>{n.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export default function App() {
  return (
    <CloudProvider>
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
                <Route path="/settings/team" element={<Team />} />
              </Routes>
            </main>
            <BottomNav />
          </div>
        }
      />
    </Routes>
    </CloudProvider>
  );
}
