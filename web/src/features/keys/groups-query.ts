import { queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type AccountGroup = {
  id: number
  name: string
  description?: string
  status: 'active' | 'disabled'
  updated_at?: string
  vm_ids?: string[]
}
export type GroupsPayload = {
  items: AccountGroup[]
  slots: { id: string; name: string; status: string }[]
}
export const groupsQueryOptions = () =>
  queryOptions({
    queryKey: ['panel', 'groups'] as const,
    queryFn: () => api<GroupsPayload>('/api/panel/groups'),
  })
