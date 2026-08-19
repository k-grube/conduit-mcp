'use client'

import { useEffect, useRef, useState } from 'react'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as mui from '@mui/material'
import { Alert } from '@mui/material'
import { api } from '../lib/api'

interface CustomBundleProps {
  pluginId: string
  route: string
}

type CleanupFn = () => void

export function CustomBundle({ pluginId, route }: CustomBundleProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<CleanupFn | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let blobUrl: string | undefined
    let cancelled = false

    async function load() {
      setError(undefined)
      try {
        const res = await api.get(`/api/plugins/${pluginId}${route}`, { responseType: 'text' })
        if (cancelled) {
          return
        }
        blobUrl = URL.createObjectURL(new Blob([res.data], { type: 'text/javascript' }))
        const mod = await import(/* webpackIgnore: true */ blobUrl)
        if (cancelled || !containerRef.current) {
          return
        }
        const shared = { React, ReactDOM, mui }
        cleanupRef.current = mod.default(containerRef.current, { pluginId, api, shared })
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load plugin bundle.')
        }
      }
    }

    load()

    return () => {
      cancelled = true
      cleanupRef.current?.()
      cleanupRef.current = undefined
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [pluginId, route])

  if (error) {
    return <Alert severity="error">Failed to load plugin bundle: {error}</Alert>
  }

  return <div ref={containerRef} />
}
