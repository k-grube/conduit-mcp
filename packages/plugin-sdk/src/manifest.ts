import { z } from 'zod'

export const SettingsFieldSchema = z.strictObject({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'secret', 'toggle', 'select', 'tags']),
  required: z.boolean().optional(),
  help: z.string().optional(),
  // select only
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
})

export const UiActionSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  // relative to /api/plugins/:id/
  route: z.string().startsWith('/'),
  method: z.enum(['GET', 'POST']),
})

export const ManifestSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'kebab-case id'),
    name: z.string().min(1),
    toolPrefix: z.string().regex(/^[a-z][a-z0-9]*_$/, 'lowercase prefix ending in _'),
    entry: z.string().min(1),
    sdkVersion: z.string().min(1),
    secrets: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'SCREAMING_SNAKE secret name')).default([]),
    // unauthenticated GET routes, e.g. oauth callbacks
    publicRoutes: z
      .array(z.string().regex(/^\/[a-z0-9/_-]*$/, 'must start with / and use lowercase path segments'))
      .default([]),
    ui: z
      .strictObject({
        settings: z.array(SettingsFieldSchema).default([]),
        actions: z.array(UiActionSchema).default([]),
        statusCheck: z.boolean().default(false),
        customBundle: z.string().optional(),
        // markdown, rendered above the settings form as a setup guide
        setupHelp: z.string().optional(),
      })
      .default({ settings: [], actions: [], statusCheck: false }),
  })
  .superRefine((data, ctx) => {
    const declared = new Set(data.secrets)
    data.ui.settings.forEach((field, i) => {
      if (field.type === 'secret' && !declared.has(field.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['ui', 'settings', i, 'key'],
          message: `secret settings field "${field.key}" is not declared in secrets`,
        })
      }
    })
  })

export type PluginManifest = z.infer<typeof ManifestSchema>
export type SettingsField = z.infer<typeof SettingsFieldSchema>
export type UiAction = z.infer<typeof UiActionSchema>

export class ManifestError extends Error {
  issues: string[]
  constructor(issues: string[]) {
    super(`invalid plugin manifest: ${issues.join('; ')}`)
    this.name = 'ManifestError'
    this.issues = issues
  }
}

export function parseManifest(json: unknown): PluginManifest {
  const result = ManifestSchema.safeParse(json)
  if (!result.success) {
    throw new ManifestError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`))
  }
  return result.data
}
