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
  getAgentSessions: (feedbackId?: string, includeIds?: string[], includeDeleted?: boolean) => {
    const params = new URLSearchParams();
    if (feedbackId) params.set('feedbackId', feedbackId);
    if (includeIds?.length) params.set('include', includeIds.join(','));
    if (includeDeleted) params.set('includeDeleted', 'true');
    const qs = params.toString();
    return request<any[]>(`/admin/agent-sessions${qs ? `?${qs}` : ''}`);
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

  archiveAgentSession: (id: string) =>
    request<{ id: string; archived: boolean }>(`/admin/agent-sessions/${id}/archive`, {
      method: 'POST',
    }),

  deleteAgentSession: (id: string) =>
    request<{ id: string; deleted: boolean }>(`/admin/agent-sessions/${id}`, {
      method: 'DELETE',
    }),

  // Aggregate / clustering
  getAggregate: (params: Record<string, string | number> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    return request<{
      clusters: any[];
      totalGroups: number;
      totalItems: number;
    }>(`/admin/aggregate?${qs}`);
  },

  analyzeAggregate: (data: { appId: string; agentEndpointId: string }) =>
    request<{ sessionId: string; feedbackId: string; itemCount: number }>('/admin/aggregate/analyze', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  analyzeCluster: (data: { appId: string; agentEndpointId: string; feedbackIds: string[]; clusterTitle: string }) =>
    request<{ sessionId: string; feedbackId: string; itemCount: number }>('/admin/aggregate/analyze-cluster', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getPlans: (appId?: string) => {
    const qs = appId ? `?appId=${encodeURIComponent(appId)}` : '';
    return request<any[]>(`/admin/aggregate/plans${qs}`);
  },

  createPlan: (data: Record<string, unknown>) =>
    request<{ id: string }>('/admin/aggregate/plans', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updatePlan: (id: string, data: Record<string, unknown>) =>
    request(`/admin/aggregate/plans/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deletePlan: (id: string) =>
    request(`/admin/aggregate/plans/${id}`, { method: 'DELETE' }),

  // Live widget connections
  getLiveConnections: () =>
    request<{
      sessionId: string;
      connectedAt: string;
      lastActivity: string;
      userAgent: string | null;
      url: string | null;
      viewport: string | null;
      userId: string | null;
      appId: string | null;
      name: string | null;
      tags: string[];
    }[]>('/agent/sessions'),

  // Launchers
  getLaunchers: () =>
    request<{ launchers: any[] }>('/admin/launchers'),

  getLauncher: (id: string) =>
    request<any>(`/admin/launchers/${id}`),

  deleteLauncher: (id: string) =>
    request<{ ok: boolean; id: string }>(`/admin/launchers/${id}`, { method: 'DELETE' }),
};
