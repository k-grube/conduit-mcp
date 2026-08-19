import { describe, expect, it, vi } from 'vitest'
import { queryNinjaSoftware, type SoftwareClient } from './software.js'

function fakeClient(pages: Record<string, unknown>[][], cursors: (string | undefined)[] = []): SoftwareClient {
  let call = 0
  return {
    querySoftware: vi.fn(async () => {
      const results = pages[call] ?? []
      const cursor = cursors[call]
      call++
      return { results, cursor }
    }),
  }
}

describe('queryNinjaSoftware pagination', () => {
  it('terminates on a short page (fewer rows than pageSize, api omits the cursor) after one call', async () => {
    const client = fakeClient([[{ name: 'a' }, { name: 'b' }]])

    const text = await queryNinjaSoftware(client, { name: 'a' })

    expect(client.querySoftware).toHaveBeenCalledTimes(1)
    expect(text).not.toContain('more results available')
    expect(text).not.toContain('partial scan')
  })

  it('stops after MAX_PAGES_PER_CALL (10) full pages during a name scan and hands back a resume cursor', async () => {
    const pages = Array.from({ length: 12 }, (_, i) =>
      Array.from({ length: 1000 }, (_, j) => ({ name: `other-${i}-${j}` })),
    )
    const cursors = Array.from({ length: 12 }, (_, i) => `cursor-${i + 1}`)
    const client = fakeClient(pages, cursors)

    const text = await queryNinjaSoftware(client, { name: 'nomatch' })

    expect(client.querySoftware).toHaveBeenCalledTimes(10)
    expect(text).toContain('partial scan')
    expect(text).toContain('cursor=cursor-10')
  })

  it('without a name filter, fetches exactly one page regardless of a returned cursor', async () => {
    const client = fakeClient([[{ name: 'x' }]], ['cursor-1'])

    const text = await queryNinjaSoftware(client, {})

    expect(client.querySoftware).toHaveBeenCalledTimes(1)
    expect(text).toContain('more results available')
    expect(text).toContain('cursor=cursor-1')
  })

  it('filters matches case-insensitively by substring when name is provided', async () => {
    const client = fakeClient([[{ name: 'TeamViewer' }, { name: 'Zoom' }, { productName: 'TeamViewer Host' }]])

    const text = await queryNinjaSoftware(client, { name: 'teamviewer' })
    const parsed = JSON.parse(text.split('\n\n[')[0])

    expect(parsed).toHaveLength(2)
  })
})
