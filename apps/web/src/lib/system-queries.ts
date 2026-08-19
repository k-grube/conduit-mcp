import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from './api'

export interface UpdateStatus {
  runningSha?: string
  imageRef?: string
  tag?: string
  remoteSha?: string
  remoteCreated?: string
  updateAvailable?: boolean
  unavailable?: string
}

// live forces the registry round trip (settings "check again"), default rides the server cache
export function useUpdateStatus(opts: { live?: boolean } = {}) {
  const live = opts.live ?? false
  return useQuery({
    queryKey: ['system-update', live],
    queryFn: () => api.get<UpdateStatus>(`/api/admin/system/update${live ? '?live=1' : ''}`).then((r) => r.data),
    refetchOnWindowFocus: false,
  })
}

export function useRestart() {
  return useMutation({
    mutationFn: () => api.post('/api/admin/system/restart').then(() => undefined),
  })
}
