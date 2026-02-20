import { useEffect } from 'preact/hooks';
import { isAuthenticated, currentRoute, navigate, selectedAppId, applications, loadApplications } from '../lib/state.js';
import { Layout } from './Layout.js';
import { LoginPage } from '../pages/LoginPage.js';
import { FeedbackListPage } from '../pages/FeedbackListPage.js';
import { FeedbackDetailPage } from '../pages/FeedbackDetailPage.js';
import { AgentsPage } from '../pages/AgentsPage.js';
import { ApplicationsPage } from '../pages/ApplicationsPage.js';
import { GettingStartedPage } from '../pages/GettingStartedPage.js';
import { SessionsPage } from '../pages/SessionsPage.js';
import { AggregatePage } from '../pages/AggregatePage.js';
import { LiveConnectionsPage } from '../pages/LiveConnectionsPage.js';
import { SettingsPage } from '../pages/SettingsPage.js';

function parseAppRoute(route: string): { appId: string; sub: string; param?: string } | null {
  const m = route.match(/^\/app\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const [, appId, rest] = m;
  const slashIdx = rest.indexOf('/');
  if (slashIdx === -1) return { appId, sub: rest };
  return { appId, sub: rest.slice(0, slashIdx), param: rest.slice(slashIdx + 1) };
}

export function App() {
  if (!isAuthenticated.value) {
    return <LoginPage />;
  }

  useEffect(() => {
    loadApplications();
  }, []);

  const route = currentRoute.value;

  // Redirect root to first app's feedback or settings
  if (route === '/' || route === '') {
    const apps = applications.value;
    if (apps.length > 0) {
      navigate(`/app/${apps[0].id}/feedback`);
      return null;
    } else {
      navigate('/settings/applications');
      return null;
    }
  }

  let page;
  const parsed = parseAppRoute(route);

  if (parsed) {
    selectedAppId.value = parsed.appId;
    if (parsed.sub === 'feedback' && parsed.param) {
      page = <FeedbackDetailPage id={parsed.param} appId={parsed.appId} />;
    } else if (parsed.sub === 'feedback') {
      page = <FeedbackListPage appId={parsed.appId} />;
    } else if (parsed.sub === 'agents') {
      // Legacy per-app agents route — redirect to global agents
      navigate('/settings/agents');
      return null;
    } else if (parsed.sub === 'sessions') {
      page = <SessionsPage appId={parsed.appId} />;
    } else if (parsed.sub === 'aggregate') {
      page = <AggregatePage appId={parsed.appId} />;
    } else if (parsed.sub === 'live') {
      page = <LiveConnectionsPage appId={parsed.appId} />;
    } else {
      page = <FeedbackListPage appId={parsed.appId} />;
    }
  } else if (route === '/settings/agents') {
    page = <AgentsPage />;
  } else if (route === '/settings/applications') {
    selectedAppId.value = null;
    page = <ApplicationsPage />;
  } else if (route === '/settings/getting-started') {
    selectedAppId.value = null;
    page = <GettingStartedPage />;
  } else if (route === '/settings/preferences') {
    selectedAppId.value = null;
    page = <SettingsPage />;
  } else if (route.startsWith('/feedback/')) {
    // Legacy route — redirect
    const id = route.replace('/feedback/', '');
    page = <FeedbackDetailPage id={id} appId={null} />;
  } else {
    // Unknown route — redirect to root
    const apps = applications.value;
    if (apps.length > 0) {
      navigate(`/app/${apps[0].id}/feedback`);
    } else {
      navigate('/settings/applications');
    }
    return null;
  }

  return <Layout>{page}</Layout>;
}
