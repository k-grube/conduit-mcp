'use client'

import { useState, type ReactNode } from 'react'
import {
  Autocomplete,
  Box,
  Button,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import type { SecretStatus, SettingsField } from '../lib/plugin-queries'

// rendered in a password input so it reads as dots, never submitted
const SECRET_MASK = '********'

// one width for every input, descriptions fill the space to the right
const FIELD_WIDTH = { xs: '100%', md: 380 }

function FieldRow({ help, children }: { help?: string; children: ReactNode }) {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={{ xs: 1, md: 6 }}
      sx={{ alignItems: { xs: 'flex-start', md: 'center' }, alignSelf: 'stretch' }}
    >
      {children}
      {help && (
        <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 560 }}>
          {help}
        </Typography>
      )}
    </Stack>
  )
}

export interface SchemaFormSaveResult {
  config: Record<string, unknown>
  secretValues: Record<string, string>
}

interface SchemaFormProps {
  fields: SettingsField[]
  values: Record<string, unknown>
  secretStatus: SecretStatus[]
  // resolve true on a successful save so typed secrets get cleared, false/reject leaves them for retry
  onSave: (result: SchemaFormSaveResult) => Promise<boolean>
  saving?: boolean
}

type FormValue = string | boolean | string[]

function initialValue(field: SettingsField, current: unknown): FormValue {
  if (field.type === 'toggle') {
    return typeof current === 'boolean' ? current : false
  }
  // secret fields are write-only, always start blank regardless of `values`
  if (field.type === 'secret') {
    return ''
  }
  if (field.type === 'tags') {
    if (Array.isArray(current)) {
      return current.filter((v): v is string => typeof v === 'string')
    }
    // value saved while the field was still a text input, split so nothing is lost on screen
    if (typeof current === 'string') {
      return current
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
    return []
  }
  return typeof current === 'string' ? current : ''
}

export function SchemaForm({ fields, values, secretStatus, onSave, saving }: SchemaFormProps) {
  const [formValues, setFormValues] = useState<Record<string, FormValue>>(() => {
    const initial: Record<string, FormValue> = {}
    for (const field of fields) {
      initial[field.key] = initialValue(field, values[field.key])
    }
    return initial
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  // secret keys the user has focused or typed into, pristine set secrets render the mask
  const [dirtySecrets, setDirtySecrets] = useState<Set<string>>(new Set())

  function setValue(key: string, value: FormValue) {
    setFormValues((prev) => ({ ...prev, [key]: value }))
  }

  function markDirty(key: string) {
    setDirtySecrets((prev) => new Set(prev).add(key))
  }

  function clearDirty(keys: string[]) {
    setDirtySecrets((prev) => {
      const next = new Set(prev)
      for (const key of keys) {
        next.delete(key)
      }
      return next
    })
  }

  function secretIsSet(key: string): boolean {
    return secretStatus.find((s) => s.name === key)?.set ?? false
  }

  async function handleSubmit() {
    const nextErrors: Record<string, string> = {}
    for (const field of fields) {
      if (!field.required || field.type === 'secret') {
        continue
      }
      const value = formValues[field.key]
      if (typeof value === 'string' && value.trim() === '') {
        nextErrors[field.key] = `${field.label} is required`
      }
      if (Array.isArray(value) && value.length === 0) {
        nextErrors[field.key] = `${field.label} is required`
      }
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      return
    }

    const config: Record<string, unknown> = {}
    const secretValues: Record<string, string> = {}
    for (const field of fields) {
      const value = formValues[field.key]
      if (field.type === 'secret') {
        if (typeof value === 'string' && value !== '') {
          secretValues[field.key] = value
        }
        continue
      }
      config[field.key] = value
    }

    const ok = await onSave({ config, secretValues })
    // only the secrets just submitted, so an unrelated later save can't wipe an untouched field's typed value
    if (ok && Object.keys(secretValues).length > 0) {
      setFormValues((prev) => {
        const next = { ...prev }
        for (const key of Object.keys(secretValues)) {
          next[key] = ''
        }
        return next
      })
      clearDirty(Object.keys(secretValues))
    }
  }

  return (
    <Stack spacing={5} sx={{ alignItems: 'flex-start' }}>
      {fields.map((field) => {
        const value = formValues[field.key]

        if (field.type === 'toggle') {
          return (
            <FieldRow key={field.key} help={field.help}>
              <FormControlLabel
                control={<Switch checked={Boolean(value)} onChange={(e) => setValue(field.key, e.target.checked)} />}
                label={field.label}
                sx={{ width: FIELD_WIDTH, mr: 0 }}
              />
            </FieldRow>
          )
        }

        if (field.type === 'select') {
          return (
            <FieldRow key={field.key} help={field.help}>
              <TextField
                select
                label={field.label}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => setValue(field.key, e.target.value)}
                size="small"
                sx={{ width: FIELD_WIDTH }}
              >
                {(field.options ?? []).map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </TextField>
            </FieldRow>
          )
        }

        if (field.type === 'tags') {
          const tags = Array.isArray(value) ? value : []
          return (
            <FieldRow key={field.key} help={field.help}>
              <Autocomplete
                multiple
                freeSolo
                options={[]}
                value={tags}
                onChange={(_e, next) => {
                  // trim, drop empties, dedupe, whatever the entry path
                  const cleaned: string[] = []
                  for (const item of next) {
                    const tag = String(item).trim()
                    if (tag && !cleaned.includes(tag)) {
                      cleaned.push(tag)
                    }
                  }
                  setValue(field.key, cleaned)
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={field.label}
                    helperText={errors[field.key]}
                    error={Boolean(errors[field.key])}
                    required={field.required}
                    size="small"
                  />
                )}
                sx={{ width: FIELD_WIDTH }}
              />
            </FieldRow>
          )
        }

        if (field.type === 'secret') {
          const isSet = secretIsSet(field.key)
          const dirty = dirtySecrets.has(field.key)
          const typed = typeof value === 'string' ? value : ''
          const pristineValue = isSet ? SECRET_MASK : ''
          return (
            <FieldRow key={field.key} help={field.help}>
              <TextField
                type="password"
                label={field.label}
                value={dirty ? typed : pristineValue}
                onFocus={() => {
                  if (!dirty) {
                    markDirty(field.key)
                  }
                }}
                onChange={(e) => {
                  markDirty(field.key)
                  setValue(field.key, e.target.value)
                }}
                onBlur={() => {
                  if (typed === '') {
                    clearDirty([field.key])
                  }
                }}
                placeholder={isSet ? undefined : 'Not set'}
                size="small"
                sx={{ width: FIELD_WIDTH }}
                slotProps={{
                  htmlInput: { autoComplete: 'new-password' },
                  input: {
                    endAdornment:
                      isSet && !dirty ? (
                        <InputAdornment position="end">
                          <CheckCircleIcon color="success" fontSize="small" titleAccess="Set" />
                        </InputAdornment>
                      ) : undefined,
                  },
                }}
              />
            </FieldRow>
          )
        }

        return (
          <FieldRow key={field.key} help={field.help}>
            <TextField
              label={field.label}
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => setValue(field.key, e.target.value)}
              helperText={errors[field.key]}
              error={Boolean(errors[field.key])}
              required={field.required}
              size="small"
              sx={{ width: FIELD_WIDTH }}
              slotProps={{ htmlInput: { autoComplete: 'off' } }}
            />
          </FieldRow>
        )
      })}
      <Box>
        <Button variant="contained" onClick={handleSubmit} disabled={saving}>
          Save
        </Button>
      </Box>
    </Stack>
  )
}
