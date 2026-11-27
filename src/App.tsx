import { NavLink, Route, Routes } from 'react-router-dom';
import { useSettings } from './hooks';
import { SpannrSymbol } from './components/Logo';
import { CalendarDays, Car, MessageCircle, Settings as SettingsIcon, Users, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from './cloud/supabase';
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
import TapToPayIntro from './payments/TapToPayIntro';
import PushSetup from './PushSetup';
import Billing from './pages/Billing';
import CloudProvider, { useCloud } from './cloud/CloudProvider';
import TechApp from './tech/TechApp';
import { isTechPreview } from './tech/preview';
import JobTemplates from './pages/JobTemplates';
import Compose from './walkaround/Compose';
import CustomerApproval from './walkaround/CustomerApproval';
import WalkRecord from './walkaround/Record';
import Reminders from './pages/Reminders';
import ClosedBusiness from './pages/ClosedBusiness';
import Admin from './pages/Admin';
import Messages from './messages/Messages';
import Reports from './pages/Reports';
import Timesheets from './time/Timesheets';
import ImportCustomers from './import/ImportCustomers';
import StockPage from './stock/StockPage';
import { OrderPage, OrdersList } from './stock/Orders';
import BookingPage from './booking/BookingPage';
import OnlineBookingSettings from './booking/OnlineBookingSettings';

/** Unread customer texts, refreshed every 30 seconds while the app is open. */
function useUnreadTexts() {
  const { businessId } = useCloud();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!businessId) return;
    const load = () => navigator.onLine && void supabase.rpc('unread_replies', { bid: businessId }).then(({ data }) => setN(Number(data) || 0));
    load();
    const t = window.setInterval(() => document.visibilityState === 'visible' && load(), 30000);
    document.addEventListener('visibilitychange', load);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', load); };
  }, [businessId]);
  return n;
}

function BottomNav() {
  const { businessType } = useSettings();
  const unread = useUnreadTexts();
  const icon = { size: 22, strokeWidth: 2 };
  const nav = [
    { to: '/', label: 'Home', icon: <SpannrSymbol size={20} />, end: true },
    { to: '/jobs', label: 'Jobs', icon: <Wrench {...icon} /> },
    businessType === 'workshop'
      ? { to: '/schedule', label: 'Workshop', icon: <Car {...icon} /> }
      : { to: '/schedule', label: 'Schedule', icon: <CalendarDays {...icon} /> },
    { to: '/customers', label: 'Customers', icon: <Users {...icon} /> },
    { to: '/messages', label: 'Messages', icon: <MessageCircle {...icon} />, badge: unread },
    { to: '/settings', label: 'Settings', icon: <SettingsIcon {...icon} /> },
  ];
  return (
    <nav className="bottom-nav">
      <div className="side-brand"><SpannrSymbol size={22} color="#f59e0b" /> <span>Spannr</span></div>
      {nav.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end}>
          <span className="nav-icon">{n.icon}{'badge' in n && n.badge ? <em className="nav-badge">{n.badge > 9 ? '9+' : n.badge}</em> : null}</span>
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
                  <Route path="/admin" element={<Admin />} />
                  <Route path="/messages" element={<Messages />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/timesheets" element={<Timesheets />} />
                  <Route path="/settings/import" element={<ImportCustomers />} />
                  <Route path="/stock" element={<StockPage />} />
                  <Route path="/orders" element={<OrdersList />} />
                  <Route path="/orders/:id" element={<OrderPage />} />
                  <Route path="/settings/booking" element={<OnlineBookingSettings />} />
                  <Route path="/settings/billing" element={<Billing />} />
                  <Route path="/settings/checklists" element={<JobTemplates />} />
                </Routes>
              </main>
              <BottomNav />
              <TapToPayWarmup />
              <TapToPayIntro />
              <PushSetup />
            </div>
          }
        />
      </Routes>
  );
}

/** Technicians get their own simplified app; owners and admins get the full one. */
function RoleSwitch() {
  const { role, plan } = useCloud();
  if (plan.closedAt) return <ClosedBusiness />;
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
      <Route path="/book/:slug" element={<BookingPage />} />
      <Route path="*" element={<StaffApp />} />
    </Routes>
  );
}
