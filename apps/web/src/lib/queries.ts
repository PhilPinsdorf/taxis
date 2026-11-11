import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { Material } from '@taxis/shared';
import { api } from './api';

export const qk = {
  materials: ['materials'] as const,
  connectors: ['connectors'] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  plan: (id: string) => ['plan', id] as const,
  snapshots: (id: string) => ['snapshots', id] as const,
  requests: (id: string) => ['requests', id] as const,
};

export function useMaterials() {
  const q = useQuery({ queryKey: qk.materials, queryFn: api.materials });
  const byId = useMemo(() => new Map<string, Material>((q.data ?? []).map((m) => [m.id, m])), [q.data]);
  return { ...q, materials: q.data ?? [], byId };
}

export const useConnectors = () => useQuery({ queryKey: qk.connectors, queryFn: api.connectorTypes });
export const useProject = (id: string) => useQuery({ queryKey: qk.project(id), queryFn: () => api.project(id) });
export const useRequests = (id: string) => useQuery({ queryKey: qk.requests(id), queryFn: () => api.requests(id) });
