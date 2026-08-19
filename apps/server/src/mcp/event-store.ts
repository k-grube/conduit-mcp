import type { TableClient } from '@azure/data-tables'
import type { EventStore } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { ensureTable } from '../storage/tables.js'

// sdk's standalone GET stream is the literal id `_GET_stream`, POST streams are randomUUID: allow underscore too
const STREAM_ID_RE = /^[A-Za-z0-9_-]+$/
const ROW_KEY_RE = /^[0-9]{14}-[0-9a-f]{4}$/

export class AdtEventStore implements EventStore {
  private tableName: string
  private client?: TableClient
  private _scope: string | undefined
  private lastMs = 0
  private seq = 0

  constructor(tableName = 'SessionEvents') {
    this.tableName = tableName
  }

  get scope(): string | undefined {
    return this._scope
  }

  // partitions storeEvent/replay by session so the shared `_GET_stream` id isn't one global partition
  set scope(value: string | undefined) {
    if (value !== undefined && !STREAM_ID_RE.test(value)) {
      throw new Error(`invalid scope: ${value}`)
    }
    this._scope = value
  }

  // same table, independent scope: lets the router hand each transport its own partition
  fork(scope?: string): AdtEventStore {
    const copy = new AdtEventStore(this.tableName)
    copy.client = this.client
    copy.scope = scope
    return copy
  }

  private partition(streamId: string): string {
    return this._scope ? `${this._scope}|${streamId}` : streamId
  }

  private async table(): Promise<TableClient> {
    if (!this.client) {
      this.client = await ensureTable(this.tableName)
    }
    return this.client
  }

  // monotonic per store: replay filters `RowKey gt`, same-ms events must sort in insertion order
  private nextRowKey(): string {
    const now = Date.now()
    if (now > this.lastMs) {
      this.lastMs = now
      this.seq = 0
    } else {
      this.seq++
    }
    return `${String(this.lastMs).padStart(14, '0')}-${this.seq.toString(16).padStart(4, '0')}`
  }

  async storeEvent(streamId: string, message: JSONRPCMessage): Promise<string> {
    const table = await this.table()
    const partitionKey = this.partition(streamId)
    const json = JSON.stringify(message)
    const attempt = async (): Promise<string> => {
      const rowKey = this.nextRowKey()
      await table.createEntity({ partitionKey, rowKey, json })
      return rowKey
    }
    let rowKey: string
    try {
      rowKey = await attempt()
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 409) {
        throw err
      }
      rowKey = await attempt() // key taken by another writer, advance the counter and retry once
    }
    return `${streamId}|${rowKey}`
  }

  async replayEventsAfter(
    lastEventId: string,
    { send }: { send: (eventId: string, message: JSONRPCMessage) => Promise<void> },
  ): Promise<string> {
    const sep = lastEventId.lastIndexOf('|')
    if (sep <= 0) {
      throw new Error(`invalid event id: ${lastEventId}`)
    }
    const streamId = lastEventId.slice(0, sep)
    const lastRowKey = lastEventId.slice(sep + 1)
    if (!ROW_KEY_RE.test(lastRowKey) || !STREAM_ID_RE.test(streamId)) {
      throw new Error(`invalid event id: ${lastEventId}`)
    }
    const table = await this.table()
    const partitionKey = this.partition(streamId)
    for await (const e of table.listEntities<{ json: string }>({
      queryOptions: { filter: `PartitionKey eq '${partitionKey}' and RowKey gt '${lastRowKey}'` },
    })) {
      await send(`${streamId}|${e.rowKey}`, JSON.parse(e.json) as JSONRPCMessage)
    }
    return streamId
  }
}
