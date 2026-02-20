import { signal, computed } from '@preact/signals';
import { api } from './api.js';

export const isAuthenticated = signal(!!localStorage.getItem('pw-admin-token'));
export const currentRoute = signal(window.location.hash.slice(1) || '/');

export const selectedAppId = signal<string | null>(null);
export const applications = signal<any[]>([]);
export const unlinkedCount = signal(0);
export const appFeedbackCounts = signal<Record<string, number>>({});

export async function loadApplications() {
  try {
    const apps = await api.getApplications();
    applications.value = apps;

    const counts: Record<string, number> = {};
    const results = await Promise.all([
      ...apps.map((app: any) => api.getFeedback({ appId: app.id, limit: 1 })),
      api.getFeedback({ appId: '__unlinked__', limit: 1 }),
    ]);
    apps.forEach((app: any, i: number) => {
      counts[app.id] = results[i].total;
    });
    appFeedbackCounts.value = counts;
    unlinkedCount.value = results[results.length - 1].total;
  } catch {
    // ignore on auth failure etc
  }
}

export function setToken(token: string) {
  localStorage.setItem('pw-admin-token', token);
  isAuthenticated.value = true;
}

export function clearToken() {
  localStorage.removeItem('pw-admin-token');
  isAuthenticated.value = false;
}

export function navigate(path: string) {
  window.location.hash = path;
  currentRoute.value = path;
}

window.addEventListener('hashchange', () => {
  currentRoute.value = window.location.hash.slice(1) || '/';
});
