# writing plugins

a plugin is a source directory: a `conduit.plugin.json` manifest next to a typescript entry module. the server bundles the entry with esbuild at load time (node 22, esm), aliasing `@conduit-mcp/plugin-sdk` and `zod` to the host's copies, registers the tools into the catalog, and mounts any routes under `/api/plugins/:pluginId`. no build step, no publishing: the server pulls source straight from git or disk.

admins installing a plugin someone else wrote can skip to [installing a custom plugin](#installing-a-custom-plugin-admins).

## layout

```
my-plugin/
  conduit.plugin.json
  package.json         # only needed for runtime deps
  src/
    index.ts           # manifest entry, default-exports definePlugin(...)
```

`conduit.plugin.json` sits at the directory root, `entry` is relative to that root. typescript bundles directly, no `dist/`.

## manifest

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "toolPrefix": "myplugin_",
  "entry": "src/index.ts",
  "sdkVersion": "^0.1",
  "secrets": ["MYPLUGIN_API_KEY"],
  "ui": {
    "setupHelp": "1. In the vendor portal create an API key.\n2. Paste it below.",
    "settings": [
      {
        "key": "baseUrl",
        "label": "Base URL",
        "type": "text",
        "required": true,
        "help": "e.g. https://api.example.com"
      },
      { "key": "MYPLUGIN_API_KEY", "label": "API key", "type": "secret", "required": true }
    ],
    "statusCheck": true
  }
}
```

| field             | rules                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`              | kebab-case, must match the id the admin registers under                                                                                                      |
| `name`            | display name in the portal                                                                                                                                   |
| `toolPrefix`      | lowercase alphanumeric ending in `_`, no hyphens. every tool name must start with it                                                                         |
| `entry`           | entry module path, relative to the plugin root                                                                                                               |
| `sdkVersion`      | sdk range the plugin targets, shown on the plugin detail page                                                                                                |
| `secrets`         | SCREAMING_SNAKE names. everything `getSecret`/`setSecret` touches must be declared here                                                                      |
| `publicRoutes`    | route paths (relative to the plugin mount) served without auth, e.g. oauth callbacks                                                                         |
| `ui.settings`     | fields on the settings form: `text`, `secret`, `toggle`, `select`, `tags` (chip list, saved as `string[]`). a secret field's key must name a declared secret |
| `ui.setupHelp`    | markdown rendered above the settings form as a setup guide                                                                                                   |
| `ui.actions`      | buttons on the settings page that call a plugin route (`GET`/`POST`)                                                                                         |
| `ui.statusCheck`  | `true` shows a status button wired to the plugin's `healthCheck`                                                                                             |
| `ui.customBundle` | plugin route serving a custom settings ui, replaces the schema form                                                                                          |

## entry module

```ts
import { definePlugin, defineTool, z, type ToolDef } from '@conduit-mcp/plugin-sdk'

const tools: ToolDef[] = [
  defineTool({
    name: 'myplugin_list_widgets',
    description: 'Search and list widgets. Filter by name or status. Returns widget records with deep links.',
    keywords: ['widgets', 'list', 'search'],
    params: {
      name: z.string().optional().describe('Filter by name'),
      page: z.number().optional().default(1).describe('Page number (default 1)'),
    },
    readOnly: true,
    handler: async (args, ctx) => {
      const key = await ctx.getSecret('MYPLUGIN_API_KEY')
      // fetch and return, large results get trimmed by the host
      return { widgets: [] }
    },
  }),
]

export default definePlugin({
  tools,
  healthCheck: async (ctx) => {
    try {
      await ctx.getSecret('MYPLUGIN_API_KEY')
      return { ok: true }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) }
    }
  },
})
```

the loader enforces: default export is a `definePlugin` result, tool names unique and prefixed with `toolPrefix`, job names unique, `intervalMs >= 1000`.

tool fields:

- `description` and `keywords` feed the search catalog. `find_tools` matches against them, so write descriptions for an llm choosing between tools: what it does, what filters exist, what comes back
- `params` is a zod raw shape, converted to json schema for clients and validated before the handler runs
- `readOnly: true` marks the tool safe for read-only role grants. anything that mutates the upstream is `readOnly: false`

optional `definePlugin` members:

- `routes(router, ctx)`: express router mounted at `/api/plugins/:id`. routes are authenticated portal calls unless listed in `publicRoutes` (public routes get no principal)
- `jobs`: `{ name, intervalMs, run(ctx) }` background jobs
- `onLoad(ctx)`: runs once at load
- `healthCheck(ctx) -> { ok, detail? }`: drives the portal status display and the status check button

## context

every handler, route, and job receives a `PluginContext`:

| member                                       | what                                                    |
| -------------------------------------------- | ------------------------------------------------------- |
| `getSecret(name)` / `setSecret(name, value)` | declared secrets, key vault in prod, env vars otherwise |
| `getConfig<T>()`                             | current values of the settings form fields              |
| `invokeTool(name, args)`                     | call another catalog tool by exact name                 |
| `logger.info/warn/error(event, data?)`       | structured log lines                                    |
| `store`                                      | per-plugin key-value storage (table storage)            |

## sdk helpers

- `OAuthCcClient`: client-credentials token client with cached refresh, one 401 retry, never follows redirects
- `assertEgressUrl(raw)`: validate an admin-entered base url before sending credentials to it. https only, blocks private/loopback/link-local hosts
- `sanitizeUpstreamBody(text)`: cap upstream error bodies before they reach tool results and the activity feed
- `stripHtml(html)` / `trimResponse(value)`: token hygiene for html-heavy or oversized responses
- `createWriteGuard(store)`: two-step confirm/commit for destructive writes, single-use tokens with a 10 minute ttl

## dependencies

runtime deps go in `package.json` `dependencies`. the server installs them with `pnpm install --prod --ignore-scripts`, so lifecycle scripts never run and packages that need a postinstall build step won't work. `@conduit-mcp/plugin-sdk` and `zod` always come from the host via esbuild alias, the plugin's own copies are ignored at runtime; the sdk dependency only matters for typechecking. the easiest dev setup is inside this repo's workspace with `"@conduit-mcp/plugin-sdk": "workspace:*"`, like the bundled plugins.

## developing locally

- drop the plugin dir under `packages/plugins` and restart: boot seeds a disabled local record for every dir with a valid manifest, enable it on the plugins page
- or register it from the portal: add plugin, source local, absolute path to the dir
- after edits, reload on the plugin detail page rebuilds the bundle from source

## installing a custom plugin (admins)

a plugin is arbitrary code running in the server process with access to its secrets and storage. install only repos you trust or have reviewed.

portal > plugins > add plugin:

1. **id**: kebab-case, must match the manifest `id`
2. **git source**: repo url (`https://`, `ssh://`, or `git@`; the server must be able to reach it, public https is simplest) plus an optional ref (branch, tag, or sha). the ref resolves to a commit at install and the plugin stays pinned to it
3. the server clones at that commit, installs prod deps, bundles, and registers the tools. any failure quarantines the plugin with a stage-prefixed error on the detail page; fix the repo and reload

after install:

- **update**: reload re-resolves the ref, so push to the branch then reload. a sha ref stays pinned
- **disable** unregisters tools, jobs, and routes but keeps the record; **delete** removes it
- **configure** on the plugin settings page: `setupHelp` renders above the form, secret fields go to key vault when configured
- **grant access**: tools stay invisible to mcp clients until a role grants the integration (read-only, full, or individual tools) on the roles page
