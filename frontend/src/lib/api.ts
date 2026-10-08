import { Business, Booking, BusinessStats, AvailabilityResponse, BusinessDraft, AssistantUnderstanding } from '../types';

export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');

let authToken: string | null = localStorage.getItem('oc_auth_token');

export function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('oc_auth_token', token);
  } else {
    localStorage.removeItem('oc_auth_token');
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

function getBaseHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

/**
 * Universal request handler for Open Counter API.
 * Uses API_BASE (defaulting to VITE_API_BASE, e.g. https://open-counter.opencounter.workers.dev).
 * If direct cross-origin fetch is rejected by Cloudflare Worker origin checks (HTTP 403),
 * transparently falls back through the same-origin gateway to the exact same remote server.
 */
async function request(path: string, options: RequestInit = {}): Promise<any> {
  const headers = { ...getBaseHeaders(), ...(options.headers as Record<string, string> || {}) };
  const primaryUrl = API_BASE ? `${API_BASE}${path}` : path;

  let response: Response | null = null;
  let primaryError: any = null;

  try {
    response = await fetch(primaryUrl, {
      ...options,
      headers,
    });
  } catch (err) {
    primaryError = err;
  }

  // If primaryUrl had a CORS/403 or network issue and API_BASE was used, try the same-origin proxy
  if ((primaryError || (response && response.status === 403 && API_BASE)) && API_BASE) {
    try {
      response = await fetch(path, {
        ...options,
        headers,
      });
      primaryError = null;
    } catch (fallbackErr) {
      throw new Error(`Unable to reach Open Counter API (${API_BASE || 'local'}). Please check your connection.`);
    }
  }

  if (primaryError) {
    throw new Error(`Unable to reach Open Counter API at ${API_BASE || window.location.origin}.`);
  }

  if (!response) {
    throw new Error('No response from Open Counter API');
  }

  if (!response.ok) {
    let errorJson: any = null;
    try {
      errorJson = await response.json();
    } catch {
      // not json
    }
    const message = errorJson?.message || errorJson?.error || `Request failed with status ${response.status}`;
    const err = new Error(message);
    (err as any).status = response.status;
    (err as any).data = errorJson;
    throw err;
  }

  return response.json();
}

export const api = {
  // Auth
  async loginDemo(draftId?: string) {
    const data = await request('/api/auth/demo', {
      method: 'POST',
      body: JSON.stringify(draftId ? { draftId } : {}),
    });
    if (data.token) {
      setAuthToken(data.token);
    }
    return data;
  },

  async getMe() {
    return request('/api/me');
  },

  // Merchant
  async getMerchantBusiness(slug: string): Promise<Business> {
    const r = await request(`/api/merchant/businesses/${slug}`); // { business }
    return r.business ?? r;
  },

  async updateMerchantBusiness(slug: string, updates: Partial<Business>): Promise<Business> {
    const r = await request(`/api/merchant/businesses/${slug}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }); // { business }
    return r.business ?? r;
  },

  async getMerchantStats(slug: string): Promise<BusinessStats> {
    return request(`/api/merchant/businesses/${slug}/stats`);
  },

  async getMerchantBookings(slug: string, filters: { from?: string; to?: string; status?: string } = {}): Promise<Booking[]> {
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.status) params.set('status', filters.status);
    const qs = params.toString();
    const r = await request(`/api/merchant/businesses/${slug}/bookings${qs ? `?${qs}` : ''}`); // { timezone, bookings }
    return Array.isArray(r) ? r : r.bookings ?? [];
  },

  async createOwnerBooking(slug: string, data: { serviceId: string; start: string; customerName: string; customerPhone?: string; idempotencyKey?: string }) {
    return request(`/api/merchant/businesses/${slug}/bookings`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async cancelOwnerBooking(slug: string, bookingId: string) {
    return request(`/api/merchant/businesses/${slug}/bookings/${bookingId}/cancel`, {
      method: 'POST',
    });
  },

  async getMerchantAvailability(slug: string, serviceId: string, date: string): Promise<AvailabilityResponse> {
    return request(`/api/merchant/businesses/${slug}/availability?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`);
  },

  async getMerchantHealth(slug: string): Promise<{ calendar: string }> {
    return request(`/api/merchant/businesses/${slug}/health`);
  },

  // Public
  async getPublicBusiness(slug: string): Promise<Business> {
    return request(`/api/public/businesses/${slug}`);
  },

  async getPublicAvailability(slug: string, serviceId: string, date: string): Promise<AvailabilityResponse> {
    return request(`/api/public/businesses/${slug}/availability?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`);
  },

  async createPublicBooking(slug: string, payload: {
    serviceId: string;
    start: string;
    customerName: string;
    customerPhone?: string;
    customerConfirmed: boolean;
    idempotencyKey: string;
  }) {
    return request(`/api/public/businesses/${slug}/bookings`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async cancelPublicBooking(slug: string, bookingId: string) {
    return request(`/api/public/businesses/${slug}/bookings/${bookingId}/cancel`, {
      method: 'POST',
    });
  },

  /** This device gets a notification for every new booking. */
  async savePush(sub: PushSubscriptionJSON) {
    return request('/api/merchant/push', { method: 'POST', body: JSON.stringify(sub) });
  },
  async deletePush(endpoint: string) {
    return request('/api/merchant/push', { method: 'DELETE', body: JSON.stringify({ endpoint }) });
  },

  /** Cancel with the six-character booking code and the name on the booking. */
  async cancelPublicByCode(slug: string, code: string, customerName: string) {
    return request(`/api/public/businesses/${slug}/cancel`, { method: 'POST', body: JSON.stringify({ code, customerName }) });
  },

  /** A signed-in owner adds a business from a finished interview draft. */
  async createBusiness(draft: BusinessDraft): Promise<Business> {
    const r = await request('/api/merchant/businesses', { method: 'POST', body: JSON.stringify({ draft }) });
    return r.business ?? r;
  },

  /** Full-page redirect to Google: signs the owner in, links their calendar and creates the business. */
  googleSignInUrl(draftId?: string) {
    const ret = `${window.location.origin}/`;
    return `${API_BASE}/auth/google/start?${draftId ? `draft=${draftId}&` : ''}return=${encodeURIComponent(ret)}`;
  },

  // Interview
  async createDraft(draft: BusinessDraft): Promise<{ draftId: string }> {
    return request('/api/drafts', {
      method: 'POST',
      body: JSON.stringify({ draft }),
    });
  },

  async interview(payload: { draft: BusinessDraft; messages?: any[]; text: string }) {
    return request('/api/interview', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Assistant NLU
  async understandUtterance(business: Business, text: string, awaiting: string | null): Promise<AssistantUnderstanding> {
    return request('/api/assistant', {
      method: 'POST',
      body: JSON.stringify({ business: business.slug, text, awaiting }), // the API expects the slug
    });
  },

  async transcribe(slug: string, audio: Blob): Promise<{ text: string }> {
    const lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
    const url = `${API_BASE}/api/transcribe?business=${encodeURIComponent(slug)}&lang=${lang}`;
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': audio.type || 'audio/webm' }, body: audio });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || 'Transcription failed');
    return j;
  },

  async getConfig(): Promise<{ googleSignIn: boolean; build: string; greeting: string; pushKey?: string | null }> {
    return request('/api/config');
  },

  /** Deletes the business and every booking record it holds. Events already in a Google Calendar stay there. */
  async deleteBusiness(slug: string) {
    return request(`/api/merchant/businesses/${slug}`, { method: 'DELETE' });
  },

  async logout() {
    try { await request('/api/auth/logout', { method: 'POST', body: '{}' }); } finally { setAuthToken(null); }
  },

  // MCP Real JSON-RPC POST
  async callMcpTool(slug: string, toolName: string, args: Record<string, any>) {
    const jsonRpcBody = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    };

    const res = await request(`/mcp/${slug}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'x-oc-channel': 'voice',
      },
      body: JSON.stringify(jsonRpcBody),
    });

    if (res.error) return { ok: false, message: res.error.message };
    if (res.result?.structuredContent) return res.result.structuredContent;
    if (res.result?.content?.[0]?.text) {
      try { return JSON.parse(res.result.content[0].text); } catch { return { ok: false, message: res.result.content[0].text }; }
    }
    return res.result;
  },
};
