import type {
  Material,
  MaterialInput,
  MaterialRequest,
  PlanDoc,
  PlanState,
  ProjectInput,
  ProjectSummary,
  RequestInput,
  SnapshotSummary,
} from '@taxis/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await fetch(url, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth')) window.dispatchEvent(new Event('taxis:unauthorized'));
    throw new ApiError(res.status, data.error ?? res.statusText, data);
  }
  return data as T;
}

const get = <T>(url: string) => request<T>('GET', url);
const post = <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {});
const put = <T>(url: string, body: unknown) => request<T>('PUT', url, body);
const del = <T>(url: string) => request<T>('DELETE', url);

export const api = {
  auth: () => get<{ required: boolean; authenticated: boolean }>('/api/auth'),
  login: (password: string) => post<{ ok: true }>('/api/auth/login', { password }),
  logout: () => post<{ ok: true }>('/api/auth/logout'),

  materials: () => get<Material[]>('/api/materials'),
  createMaterial: (m: MaterialInput) => post<Material>('/api/materials', m),
  updateMaterial: (id: string, m: MaterialInput) => put<Material>(`/api/materials/${id}`, m),
  archiveMaterial: (id: string) => del<{ ok: true }>(`/api/materials/${id}`),
  connectorTypes: () => get<string[]>('/api/connector-types'),
  saveConnectorTypes: (names: string[]) => put<string[]>('/api/connector-types', names),

  projects: () => get<ProjectSummary[]>('/api/projects'),
  project: (id: string) => get<ProjectSummary>(`/api/projects/${id}`),
  createProject: (p: ProjectInput) => post<ProjectSummary>('/api/projects', p),
  updateProject: (id: string, p: ProjectInput) => put<ProjectSummary>(`/api/projects/${id}`, p),
  deleteProject: (id: string) => del<{ ok: true }>(`/api/projects/${id}`),
  duplicateProject: (id: string, name: string, snapshotId?: string) =>
    post<ProjectSummary>(`/api/projects/${id}/duplicate`, { name, snapshotId }),

  plan: (id: string) => get<PlanState>(`/api/projects/${id}/plan`),
  savePlan: (id: string, doc: PlanDoc, revision: number) =>
    put<{ revision: number }>(`/api/projects/${id}/plan`, { doc, revision }),

  snapshots: (id: string) => get<SnapshotSummary[]>(`/api/projects/${id}/snapshots`),
  snapshot: (id: string, sid: string) => get<SnapshotSummary & { doc: PlanDoc }>(`/api/projects/${id}/snapshots/${sid}`),
  createSnapshot: (id: string, name: string, note: string) =>
    post<SnapshotSummary>(`/api/projects/${id}/snapshots`, { name, note }),
  restoreSnapshot: (id: string, sid: string) => post<PlanState>(`/api/projects/${id}/snapshots/${sid}/restore`),
  deleteSnapshot: (id: string, sid: string) => del<{ ok: true }>(`/api/projects/${id}/snapshots/${sid}`),

  requests: (id: string) => get<MaterialRequest[]>(`/api/projects/${id}/requests`),
  createRequest: (id: string, r: RequestInput) => post<MaterialRequest>(`/api/projects/${id}/requests`, r),
  updateRequest: (id: string, rid: string, r: RequestInput) =>
    put<MaterialRequest>(`/api/projects/${id}/requests/${rid}`, r),
  deleteRequest: (id: string, rid: string) => del<{ ok: true }>(`/api/projects/${id}/requests/${rid}`),

  uploadImage: (blob: Blob, width: number, height: number, name = 'plan.png') => {
    const fd = new FormData();
    fd.append('width', String(width));
    fd.append('height', String(height));
    fd.append('file', blob, name);
    return post<{ id: string; width: number; height: number }>('/api/images', fd);
  },
  imageUrl: (id: string) => `/api/images/${id}`,
};

/** SQLite liefert UTC ohne Zeitzone */
export function formatDate(s: string, withTime = true): string {
  if (!s) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? new Date(`${s}T00:00:00`)
    : new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('de-DE', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}
