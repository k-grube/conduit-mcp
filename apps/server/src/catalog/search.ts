import MiniSearch from 'minisearch'
import type { CatalogEntry, ToolCatalog } from './catalog.js'

interface IndexedDoc {
  id: string
  name: string
  description: string
  keywords: string
  notes: string
}

export class ToolSearch {
  private catalog: ToolCatalog
  private index: MiniSearch<IndexedDoc> | undefined
  private indexedVersion = -1

  constructor(catalog: ToolCatalog) {
    this.catalog = catalog
  }

  private ensureIndex(): MiniSearch<IndexedDoc> {
    if (!this.index || this.indexedVersion !== this.catalog.version) {
      this.index = new MiniSearch<IndexedDoc>({
        fields: ['name', 'description', 'keywords', 'notes'],
        searchOptions: { boost: { name: 3, keywords: 2 }, prefix: true, fuzzy: 0.2 },
      })
      this.index.addAll(
        this.catalog.list().map((e) => ({
          id: e.name,
          name: e.name,
          description: e.description,
          keywords: e.keywords.join(' '),
          notes: e.notes ?? '',
        })),
      )
      this.indexedVersion = this.catalog.version
    }
    return this.index
  }

  search(query: string, opts: { integration?: string; limit?: number } = {}): CatalogEntry[] {
    const limit = opts.limit ?? 10
    const hits = this.ensureIndex().search(query)
    const out: CatalogEntry[] = []
    for (const hit of hits) {
      const entry = this.catalog.get(hit.id as string)
      if (!entry) {
        continue
      }
      if (opts.integration && entry.pluginId !== opts.integration) {
        continue
      }
      out.push(entry)
      if (out.length >= limit) {
        break
      }
    }
    return out
  }
}
