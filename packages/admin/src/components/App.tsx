import { isAuthenticated, currentRoute } from '../lib/state.js';
import { Layout } from './Layout.js';
import { LoginPage } from '../pages/LoginPage.js';
import { FeedbackListPage } from '../pages/FeedbackListPage.js';
import { FeedbackDetailPage } from '../pages/FeedbackDetailPage.js';
import { AgentsPage } from '../pages/AgentsPage.js';

export function App() {
  if (!isAuthenticated.value) {
    return <LoginPage />;
  }

  const route = currentRoute.value;

  let page;
  if (route.startsWith('/feedback/')) {
    const id = route.replace('/feedback/', '');
    page = <FeedbackDetailPage id={id} />;
  } else if (route === '/agents') {
    page = <AgentsPage />;
  } else {
    page = <FeedbackListPage />;
  }

  return <Layout>{page}</Layout>;
}
