import { assertEgressUrl, sanitizeUpstreamBody, type PluginContext } from '@conduit-mcp/plugin-sdk'

export interface HuduConfig {
  baseUrl?: string
  writesEnabled?: boolean
  archiveEnabled?: boolean
  draftFolderName?: string
}

interface ArticleCreateInput {
  name: string
  content: string
  folder_id?: number
  company_id?: number
  enable_sharing?: boolean
}

interface ArticleUpdateInput {
  name?: string
  content?: string
  folder_id?: number
  enable_sharing?: boolean
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

// x-api-key header auth, no oauth. baseUrl/apiKey resolved lazily from ctx and cached per client instance
export class HuduClient {
  private ctx: PluginContext
  private fetchFn: typeof fetch
  private folderCache = new Map<string, number>()
  private resolvedBaseUrl?: string

  constructor(opts: { ctx: PluginContext; fetchFn?: typeof fetch }) {
    this.ctx = opts.ctx
    this.fetchFn = opts.fetchFn ?? fetch
  }

  private async resolveBaseUrl(): Promise<string> {
    if (!this.resolvedBaseUrl) {
      const cfg = await this.ctx.getConfig<HuduConfig>()
      if (!cfg.baseUrl) {
        throw new Error('missing required hudu setting: baseUrl')
      }
      this.resolvedBaseUrl = assertEgressUrl(cfg.baseUrl)
    }
    return this.resolvedBaseUrl
  }

  // baseUrl for deep-link building, only valid after at least one request resolved it
  get baseUrl(): string {
    if (!this.resolvedBaseUrl) {
      throw new Error('hudu client: base url not resolved yet')
    }
    return this.resolvedBaseUrl
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    opts: { params?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<T> {
    const base = await this.resolveBaseUrl()
    const apiKey = await this.ctx.getSecret('HUDU_API_KEY')
    const url = new URL(`${base}/api/v1${path}`)
    if (opts.params) {
      for (const [key, value] of Object.entries(opts.params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }
    // never follow a redirect, a cross-origin hop would leak the x-api-key to another host
    const init: RequestInit = { method, headers: { 'x-api-key': apiKey }, redirect: 'error' }
    if (opts.body !== undefined) {
      init.headers = { ...init.headers, 'content-type': 'application/json' }
      init.body = JSON.stringify(opts.body)
    }
    const res = await this.fetchFn(url, init)
    if (!res.ok) {
      throw new Error(`hudu request failed: ${res.status} ${sanitizeUpstreamBody(await safeText(res))}`)
    }
    return (await res.json()) as T
  }

  async getCompanies(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('GET', '/companies', { params })
  }

  async getCompanyById(id: number): Promise<unknown> {
    return this.request('GET', `/companies/${id}`)
  }

  async getArticles(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('GET', '/articles', { params })
  }

  async getArticleById(id: number): Promise<unknown> {
    return this.request('GET', `/articles/${id}`)
  }

  async createArticle(input: ArticleCreateInput): Promise<Record<string, unknown>> {
    const data = await this.request<{ article: Record<string, unknown> }>('POST', '/articles', {
      body: { article: input },
    })
    return data.article
  }

  async updateArticle(id: number, input: ArticleUpdateInput): Promise<Record<string, unknown>> {
    const data = await this.request<{ article: Record<string, unknown> }>('PUT', `/articles/${id}`, {
      body: { article: input },
    })
    return data.article
  }

  async archiveArticle(id: number): Promise<Record<string, unknown>> {
    const data = await this.request<{ article: Record<string, unknown> }>('PUT', `/articles/${id}/archive`)
    return data.article
  }

  async unarchiveArticle(id: number): Promise<Record<string, unknown>> {
    const data = await this.request<{ article: Record<string, unknown> }>('PUT', `/articles/${id}/unarchive`)
    return data.article
  }

  async findOrCreateDraftFolder(companyId: number | null, folderName: string): Promise<number> {
    const cacheKey = `${companyId ?? 'central'}:${folderName}`
    const cached = this.folderCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }
    const params: Record<string, unknown> = { name: folderName }
    if (companyId !== null) {
      params.company_id = companyId
    }
    const lookup = await this.request<{ folders?: Array<{ id: number; company_id: number | null }> }>(
      'GET',
      '/folders',
      { params },
    )
    const folders = lookup.folders
    const matches = companyId === null ? (folders ?? []).filter((f) => f.company_id === null) : (folders ?? [])
    if (matches.length > 0) {
      this.folderCache.set(cacheKey, matches[0].id)
      return matches[0].id
    }
    const folderBody: Record<string, unknown> = { name: folderName }
    if (companyId !== null) {
      folderBody.company_id = companyId
    }
    const created = await this.request<{ folder: { id: number } }>('POST', '/folders', { body: { folder: folderBody } })
    this.folderCache.set(cacheKey, created.folder.id)
    return created.folder.id
  }

  async getArticleBySlug(slug: string): Promise<unknown> {
    for (let page = 1; page <= 20; page++) {
      const data = await this.request<{ articles?: Record<string, unknown>[] }>('GET', '/articles', {
        params: { page, page_size: 100 },
      })
      const articles = data.articles
      if (!articles || articles.length === 0) {
        break
      }
      const found = articles.find((a) => a.slug === slug)
      if (found) {
        return this.request('GET', `/articles/${found.id}`)
      }
    }
    return null
  }

  async getAssets(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('GET', '/assets', { params })
  }

  async getAssetById(id: number): Promise<unknown> {
    return this.request('GET', `/assets/${id}`)
  }

  async getAssetLayouts(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('GET', '/asset_layouts', { params })
  }

  async getActivityLogs(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('GET', '/activity_logs', { params })
  }

  async getFolders(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('GET', '/folders', { params })
  }

  async getFolderById(id: number): Promise<unknown> {
    return this.request('GET', `/folders/${id}`)
  }

  async getProcedures(params?: Record<string, unknown>): Promise<unknown> {
    return this.request('GET', '/procedures', { params })
  }

  async getProcedureById(id: number): Promise<unknown> {
    return this.request('GET', `/procedures/${id}`)
  }
}

// single config per plugin, module-scope holder cached across tool calls
let cached: HuduClient | undefined

export function getClient(ctx: PluginContext, fetchFn?: typeof fetch): HuduClient {
  if (!cached) {
    cached = new HuduClient({ ctx, fetchFn })
  }
  return cached
}

export function resetClient(): void {
  cached = undefined
}
