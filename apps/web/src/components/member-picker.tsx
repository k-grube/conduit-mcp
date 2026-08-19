'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Autocomplete, Stack, TextField } from '@mui/material'
import { api } from '../lib/api'
import type { RoleMembers } from '../lib/role-queries'

interface GraphPrincipalHit {
  id: string
  displayName: string
  userPrincipalName?: string
}

type PrincipalOption = GraphPrincipalHit | string

function optionLabel(opt: PrincipalOption): string {
  if (typeof opt === 'string') {
    return opt
  }
  return opt.userPrincipalName ? `${opt.displayName} (${opt.userPrincipalName})` : opt.displayName
}

function optionId(opt: PrincipalOption): string {
  return typeof opt === 'string' ? opt : opt.id
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

// graph-router.ts rejects q shorter than 2 chars, gate the fetch to match
const MIN_QUERY_LENGTH = 2

function usePrincipalSearch(kind: 'users' | 'groups', q: string) {
  return useQuery({
    queryKey: ['graph', kind, q],
    queryFn: () =>
      api
        .get<{ items: GraphPrincipalHit[] }>(`/api/admin/graph/${kind}?q=${encodeURIComponent(q)}`)
        .then((r) => r.data.items),
    enabled: q.length >= MIN_QUERY_LENGTH,
  })
}

interface PrincipalFieldProps {
  label: string
  kind: 'users' | 'groups'
  ids: string[]
  onChange: (ids: string[]) => void
}

function PrincipalField({ label, kind, ids, onChange }: PrincipalFieldProps) {
  const [input, setInput] = useState('')
  const debounced = useDebouncedValue(input, 300)
  const { data, isError } = usePrincipalSearch(kind, debounced)
  // resolves display labels for selected ids, seeded from search results as they come back
  const [cache, setCache] = useState<Record<string, GraphPrincipalHit>>({})

  useEffect(() => {
    if (!data) {
      return
    }
    setCache((prev) => {
      const next = { ...prev }
      for (const hit of data) {
        next[hit.id] = hit
      }
      return next
    })
  }, [data])

  const value: PrincipalOption[] = ids.map((id) => cache[id] ?? id)
  const options: PrincipalOption[] = data ?? []

  return (
    <Autocomplete
      multiple
      freeSolo
      options={options}
      value={value}
      inputValue={input}
      onInputChange={(_e, newInput) => setInput(newInput)}
      getOptionLabel={optionLabel}
      isOptionEqualToValue={(opt, val) => optionId(opt) === optionId(val)}
      onChange={(_e, newValue) => {
        const nextCache = { ...cache }
        const nextIds = newValue.map((v) => {
          if (typeof v !== 'string') {
            nextCache[v.id] = v
          }
          return optionId(v)
        })
        setCache(nextCache)
        onChange(nextIds)
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          size="small"
          helperText={isError ? 'Directory search unavailable.' : undefined}
        />
      )}
    />
  )
}

interface MemberPickerProps {
  value: RoleMembers
  onChange: (value: RoleMembers) => void
}

export function MemberPicker({ value, onChange }: MemberPickerProps) {
  return (
    <Stack spacing={2}>
      <PrincipalField
        label="Users"
        kind="users"
        ids={value.users}
        onChange={(users) => onChange({ ...value, users })}
      />
      <PrincipalField
        label="Groups"
        kind="groups"
        ids={value.groups}
        onChange={(groups) => onChange({ ...value, groups })}
      />
    </Stack>
  )
}
