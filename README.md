# conduit-mcp

remote MCP server that fronts multiple SaaS integrations behind three meta-tools. instead of exposing a hundred-plus tools to every client, the server exposes `list_integrations`, `find_tools`, and `invoke_tool`: clients search the catalog by task description, get back matching tool schemas, and invoke by exact name. an admin portal manages plugins, api keys, roles, and usage.

bundled integrations: HaloPSA, Hudu, CIPP, NinjaRMM, QuickBooks Online.

## layout

| path                  | what                                                               |
| --------------------- | ------------------------------------------------------------------ |
| `apps/server`         | express api: `/mcp` endpoint, oauth proxy, portal api, plugin host |
| `apps/web`            | next.js static-export admin portal (MSAL sign-in)                  |
| `packages/plugin-sdk` | types + helpers plugins build against                              |
| `packages/plugins/*`  | bundled integrations, source + `conduit.plugin.json` manifest      |
| `scripts/`            | local dev setup (`.ps1` and `.sh`) + `dev.mjs` process wrapper     |
| `infra/`              | bicep templates + entra app registration script                    |

## how to run

needs node >= 22 and pnpm via corepack (version pinned in `package.json` `packageManager`).

```
corepack enable
scripts/setup.ps1    # or setup.sh: frozen-lockfile install + full workspace build
pnpm dev
```

`pnpm dev` runs everything in one terminal via concurrently, output prefixed per process: azurite (in-memory table storage), sdk + server tsc watchers, the api server, and next dev. ctrl+C stops the lot. `pnpm serve` skips the watchers and serves the prebuilt api + static web export only.

- portal: http://localhost:3000 (next dev, proxies api calls to :4000)
- api + mcp: http://localhost:4000 (`/healthz`, `/mcp`)

with no config the server boots unconfigured and the portal shows the bootstrap setup wizard, which walks through entra app setup. to skip it, copy `.dev.env.example` to `.dev.env` and pre-seed `ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID` / `BOOTSTRAP_ADMIN_OID`; `pnpm dev` loads it at boot.

repo-wide checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

## how it works

**mcp surface.** `/mcp` speaks streamable http. requests authenticate with an entra bearer token or a conduit api key. for clients that only speak oauth, the server proxies authorization to entra (authorization server metadata + dynamic client registration). sessions and event streams persist in table storage, so streams survive reconnects.

**catalog + meta-tools.** every plugin tool is indexed into a searchable catalog (minisearch). `find_tools` returns matching tool schemas, `invoke_tool` executes by exact name and records usage. permissions filter both search hits and invokes, so a principal only sees tools its grants allow.

**plugins.** a plugin is a source directory with a `conduit.plugin.json` manifest (id, entry, secret names, portal settings ui, public routes). the loader bundles the entry with esbuild at load time against the host's sdk, registers its tools into the catalog, and mounts any portal routes under `/api/plugins/:pluginId`. the packages in `packages/plugins` seed automatically; more can be installed from git through the portal. [docs/writing-plugins.md](docs/writing-plugins.md) covers authoring a plugin against the sdk and installing a custom one.

**auth model.** principals are entra users or api keys. roles carry per-integration grants (read-only or full, down to individual tools) and are resolved per request; portal access is a separate surface, portal roles never widen mcp tool access. `BOOTSTRAP_ADMIN_OID` seeds the first admin.

**storage + secrets.** azure table storage holds all state (config, plugin registry, roles, api keys, usage, mcp sessions); azurite stands in locally. secrets go to key vault when `AZURE_KEYVAULT_URL` is set, plain env vars otherwise.

**portal.** next.js static export, served by the api server itself in production (`apps/web/out`); local watch mode runs `next dev` instead.

## deploy

`Dockerfile` builds a self-contained server image with the web export baked in. ci (`.github/workflows/deploy.yml`) tests, then builds and pushes `ghcr.io/<owner>/<repo>:<sha>` on every main push. first publish only: the package defaults to private, flip it public in repo settings > packages so app service can pull without registry credentials.

`infra/main.bicep` (subscription scope) provisions the resource group, app service, storage, and key vault. the entra app registration happens one of two ways:

**setup wizard, one bicep run.** deploy with the entra params blank and open the portal: the bootstrap wizard signs you in via device code, creates the app registration through graph, and writes tenant/client ids to config storage. `/api/setup/*` is unauthenticated until setup completes and the first signer becomes admin (trust-on-first-use); the setup gate 404s those endpoints afterwards.

**scripted, two bicep runs.** no open setup window, the server boots already configured. the entra script needs run 1's outputs (webapp url for redirect uris, key vault name for the client secret), and bicep can't create app registrations itself, hence the second run to land the ids as app settings.

```
# 1. infra, entra params blank. operatorObjectId grants the KV write step 2 needs
az deployment sub create -l eastus2 -f infra/main.bicep \
  -p image=ghcr.io/<owner>/conduit-mcp:<sha> bootstrapAdminOid=<your-oid> operatorObjectId=<your-oid>

# 2. app registration + client secret into key vault
#    PS7, az login as a user with Application.ReadWrite.OwnedBy, -DryRun to preview
./infra/scripts/setup-entra-app.ps1 -DisplayName "conduit-mcp" \
  -ProdUrl <webAppUrl output> -KeyVaultName <keyVaultName output>

# 3. same deployment plus the ids the script printed
az deployment sub create -l eastus2 -f infra/main.bicep \
  -p image=ghcr.io/<owner>/conduit-mcp:<sha> bootstrapAdminOid=<your-oid> operatorObjectId=<your-oid> \
     entraTenantId=<tenant-id> entraClientId=<client-id>
```

the app settings change restarts the container; boot seeds the ids into the config store (fills blank fields only, config put stays authoritative).

**continuous deploy, opt-in.** create an oidc federation for the workflow, set secrets `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID` and vars `AZURE_WEBAPP_NAME` / `AZURE_RESOURCE_GROUP`, then set repo var `AZURE_DEPLOY=true`. main pushes then repoint the webapp at the freshly pushed image.

**in-portal updates.** settings shows whether the registry image differs from the running build (ci bakes the git sha into the image) and can restart the app to pull it; the restart uses a restart-only custom role granted to the managed identity by the bicep, so deployments created before that role existed need a bicep rerun to get the button working.
