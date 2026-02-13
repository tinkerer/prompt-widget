const BASE = '/api/v1';

function getToken(): string | null {
  return localStorage.getItem('pw-admin-token');
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!headers['Content-Type'] && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    localStorage.removeItem('pw-admin-token');
    window.location.hash = '#/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; expiresAt: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  getFeedback: (params: Record<string, string | number> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    return request<{
      items: any[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(`/admin/feedback?${qs}`);
  },

  getFeedbackById: (id: string) => request<any>(`/admin/feedback/${id}`),

  updateFeedback: (id: string, data: Record<string, unknown>) =>
    request(`/admin/feedback/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteFeedback: (id: string) =>
    request(`/admin/feedback/${id}`, { method: 'DELETE' }),

  batchOperation: (data: { ids: string[]; operation: string; value?: string }) =>
    request('/admin/feedback/batch', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getAgents: () => request<any[]>('/admin/agents'),

  createAgent: (data: Record<string, unknown>) =>
    request('/admin/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateAgent: (id: string, data: Record<string, unknown>) =>
    request(`/admin/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteAgent: (id: string) =>
    request(`/admin/agents/${id}`, { method: 'DELETE' }),

  dispatch: (data: { feedbackId: string; agentEndpointId: string; instructions?: string }) =>
    request<{ dispatched: boolean; sessionId?: string; status: number; response: string }>('/admin/dispatch', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getApplications: () => request<any[]>('/admin/applications'),

  getApplication: (id: string) => request<any>(`/admin/applications/${id}`),

  createApplication: (data: Record<string, unknown>) =>
    request<{ id: string; apiKey: string }>('/admin/applications', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateApplication: (id: string, data: Record<string, unknown>) =>
    request(`/admin/applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteApplication: (id: string) =>
    request(`/admin/applications/${id}`, { method: 'DELETE' }),

  regenerateApplicationKey: (id: string) =>
    request<{ id: string; apiKey: string }>(`/admin/applications/${id}/regenerate-key`, {
      method: 'POST',
    }),

  // Agent sessions
  getAgentSessions: (feedbackId?: string) => {
    const qs = feedbackId ? `?feedbackId=${feedbackId}` : '';
    return request<any[]>(`/admin/agent-sessions${qs}`);
  },

  getAgentSession: (id: string) =>
    request<any>(`/admin/agent-sessions/${id}`),

  killAgentSession: (id: string) =>
    request<{ id: string; killed: boolean }>(`/admin/agent-sessions/${id}/kill`, {
      method: 'POST',
    }),

  resumeAgentSession: (id: string) =>
    request<{ sessionId: string }>(`/admin/agent-sessions/${id}/resume`, {
      method: 'POST',
    }),
};
