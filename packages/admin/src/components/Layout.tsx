import { ComponentChildren } from 'preact';
import { currentRoute, clearToken, navigate } from '../lib/state.js';

export function Layout({ children }: { children: ComponentChildren }) {
  const route = currentRoute.value;

  return (
    <div class="layout">
      <div class="sidebar">
        <h1>Prompt Widget</h1>
        <nav>
          <a
            href="#/"
            class={route === '/' || route === '' ? 'active' : ''}
            onClick={() => navigate('/')}
          >
            Feedback
          </a>
          <a
            href="#/agents"
            class={route === '/agents' ? 'active' : ''}
            onClick={() => navigate('/agents')}
          >
            Agent Endpoints
          </a>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              clearToken();
              navigate('/login');
            }}
          >
            Logout
          </a>
        </nav>
      </div>
      <div class="main">{children}</div>
    </div>
  );
}
