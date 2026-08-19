# pnpm version pinned from package.json's packageManager field
# base image pinned by digest -- node:22-bookworm-slim, resolved via
# `docker buildx imagetools inspect node:22-bookworm-slim`
FROM node:22-bookworm-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46 AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
COPY . .
# pnpm-workspace.yaml ignoreScripts applies here too -- esbuild needs no postinstall,
# its native binary ships as a linux/amd64 optionalDependency
RUN pnpm install --frozen-lockfile
RUN pnpm -r build
# prod deploy for apps/server: external deps become a self-contained store, but the
# workspace sdk comes out as a symlink into the build-stage repo layout (non-legacy
# deploy needs inject-workspace-packages=true workspace-wide, breaks sdk watch in dev)
RUN pnpm --filter @conduit-mcp/server deploy --prod --legacy /app/deploy/server
# dereference that symlink so the runtime stage resolves the sdk; its node_modules are
# store links (dropped), zod resolves from the server's own top-level dep
RUN rm /app/deploy/server/node_modules/@conduit-mcp/plugin-sdk \
  && cp -r /app/packages/plugin-sdk /app/deploy/server/node_modules/@conduit-mcp/plugin-sdk \
  && rm -rf /app/deploy/server/node_modules/@conduit-mcp/plugin-sdk/node_modules
# packages/plugins ship as source, esbuild-bundled at plugin-load time via the sdk/zod
# aliases in apps/server's own node_modules -- drop the workspace-store symlinks here so
# the runtime image doesn't carry dangling links into a store it won't have
RUN find packages/plugins -maxdepth 2 -name node_modules -type d -prune -exec rm -rf {} +

# base image pinned by digest -- node:22-bookworm-slim, resolved via
# `docker buildx imagetools inspect node:22-bookworm-slim`
FROM node:22-bookworm-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46 AS runtime
WORKDIR /app
# git: runtime git-plugin installs clone with it. pnpm: same install path runs
# `pnpm install --prod` against the cloned plugin's own package.json
# apt packages unpinned -- debian point-release churn makes exact version pins brittle,
# the base image digest above is the real reproducibility anchor
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd --system conduit \
  && useradd --system --gid conduit --create-home --home-dir /home/conduit conduit
# corepack's default cache lives under $HOME/.cache/node/corepack -- prepared here as root,
# it'd be unreachable once the runtime git-plugin install path runs `pnpm install` as conduit.
# point it at a dir created for both, then hand it to conduit after prepare writes as root
ENV COREPACK_HOME=/opt/corepack
RUN mkdir -p "$COREPACK_HOME" \
  && corepack enable \
  && corepack prepare pnpm@11.20.0 --activate \
  && chown -R conduit:conduit "$COREPACK_HOME"

# dist + node_modules + package.json: package.json carries "type":"module", which node
# needs to parse the compiled dist/*.js as esm instead of defaulting to commonjs
COPY --from=build /app/deploy/server/dist ./apps/server/dist
COPY --from=build /app/deploy/server/node_modules ./apps/server/node_modules
COPY --from=build /app/deploy/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/web/out ./apps/web/out
COPY --from=build /app/packages/plugins ./packages/plugins

# baked by CI so the running container knows its own identity for the update check;
# empty on local builds, which disables the check
ARG GIT_SHA=''
ARG IMAGE_REF=''
ENV PORT=8080 \
    WEB_DIST=/app/apps/web/out \
    IN_REPO_PLUGINS_DIR=/app/packages/plugins \
    PLUGINS_ROOT=/home/conduit/plugins \
    CONDUIT_IMAGE_SHA=$GIT_SHA \
    CONDUIT_IMAGE_REF=$IMAGE_REF

RUN mkdir -p "$PLUGINS_ROOT" && chown -R conduit:conduit /app /home/conduit
USER conduit

EXPOSE 8080
CMD ["node", "apps/server/dist/index.js"]
