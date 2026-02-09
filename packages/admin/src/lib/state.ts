import { signal, computed } from '@preact/signals';

export const isAuthenticated = signal(!!localStorage.getItem('pw-admin-token'));
export const currentRoute = signal(window.location.hash.slice(1) || '/');

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
