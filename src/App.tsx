import { NavLink, Route, Routes } from 'react-router-dom';
import { useSettings } from './hooks';
import { SpannrSymbol } from './components/Logo';
import { CalendarDays, Car, Settings as SettingsIcon, Users, Wrench } from 'lucide-react';
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
import CardPayments from './payments/CardPayments';
import TapToPaySettings from './payments/TapToPaySettings';
import TapToPayWarmup from './payments/TapToPayWarmup';
import Billing from './pages/Billing';
import CloudProvider, { useCloud } from './cloud/CloudProvider';
import TechApp from './tech/TechApp';
import { isTechPreview } from './tech/preview';
import JobTemplates from './pages/JobTemplates';
import Compose from './walkaround/Compose';
import CustomerApproval from './walkaround/CustomerApproval';
import WalkRecord from './walkaround/Record';
import Reminders from './pages/Reminders';

function BottomNav() {
  const { businessType } = useSettings();
  const icon = { size: 22, strokeWidth: 2 };
  const nav = [
    { to: '/', label: 'Home', icon: <SpannrSymbol size={20} />, end: true },
    { to: '/jobs', label: 'Jobs', icon: <Wrench {...icon} /> },
    businessType === 'workshop'
      ? { to: '/schedule', label: 'Workshop', icon: <Car {...icon} /> }
      : { to: '/schedule', label: 'Schedule', icon: <CalendarDays {...icon} /> },
    { to: '/customers', label: 'Customers', icon: <Users {...icon} /> },
    { to: '/settings', label: 'Settings', icon: <SettingsIcon {...icon} /> },
  ];
  return (
    <nav className="bottom-nav">
      <div className="side-brand"><SpannrSymbol size={22} color="#f59e0b" /> <span>Spannr</span></div>
      {nav.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end}>
          <span className="nav-icon">{n.icon}</span>
          <span>{n.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function OwnerApp() {
  return (
      <Routes>
        <Route path="/jobs/:id/video" element={<Compose />} />
        <Route path="/jobs/:id/:docType" element={<DocumentView />} />
        <Route path="/walkaround/:id" element={<WalkRecord />} />
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
                  <Route path="/settings/payments" element={<CardPayments />} />
                  <Route path="/settings/tap-to-pay" element={<TapToPaySettings />} />
                  <Route path="/settings/billing" element={<Billing />} />
                  <Route path="/settings/checklists" element={<JobTemplates />} />
                </Routes>
              </main>
              <BottomNav />
              <TapToPayWarmup />
            </div>
          }
        />
      </Routes>
  );
}

/** Technicians get their own simplified app; owners and admins get the full one. */
function RoleSwitch() {
  const { role } = useCloud();
  return role === 'tech' || isTechPreview() ? <TechApp /> : <OwnerApp />;
}

function StaffApp() {
  return (
    <CloudProvider>
      <RoleSwitch />
    </CloudProvider>
  );
}

export default function App() {
  return (
    <Routes>
      {/* Customer-facing page: no login */}
      <Route path="/v/:token" element={<CustomerApproval />} />
      <Route path="*" element={<StaffApp />} />
    </Routes>
  );
}
