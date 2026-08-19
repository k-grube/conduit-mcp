import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineTool, definePlugin, validateAgainstManifest, toolJsonSchema, PluginDefinitionError } from './plugin.js'
import { parseManifest } from './manifest.js'

const manifest = parseManifest({
  id: 'demo',
  name: 'Demo',
  toolPrefix: 'demo_',
  entry: 'src/index.ts',
  sdkVersion: '^0.1',
})

const echoTool = {
  name: 'demo_echo',
  description: 'echo input back',
  keywords: ['echo', 'test'],
  params: { text: z.string() },
  readOnly: true,
  handler: async (args: { text: string }) => args.text,
}

describe('definePlugin', () => {
  it('returns the definition', () => {
    const p = definePlugin({ tools: [echoTool] })
    expect(p.tools).toHaveLength(1)
  })

  it('rejects duplicate tool names', () => {
    expect(() => definePlugin({ tools: [echoTool, { ...echoTool }] })).toThrow(PluginDefinitionError)
  })

  it('rejects jobs with intervalMs < 1000', () => {
    expect(() =>
      definePlugin({ tools: [echoTool], jobs: [{ name: 'j', intervalMs: 10, run: async () => {} }] }),
    ).toThrow(PluginDefinitionError)
  })

  it('rejects duplicate job names', () => {
    expect(() =>
      definePlugin({
        tools: [echoTool],
        jobs: [
          { name: 'tick', intervalMs: 1000, run: async () => {} },
          { name: 'tick', intervalMs: 2000, run: async () => {} },
        ],
      }),
    ).toThrow(/duplicate job name/)
  })
})

describe('validateAgainstManifest', () => {
  it('passes when all tools carry the prefix', () => {
    expect(() => validateAgainstManifest(definePlugin({ tools: [echoTool] }), manifest)).not.toThrow()
  })

  it('throws on unprefixed tool', () => {
    const bad = definePlugin({ tools: [{ ...echoTool, name: 'echo' }] })
    expect(() => validateAgainstManifest(bad, manifest)).toThrow(/prefix/)
  })
})

describe('toolJsonSchema', () => {
  it('produces a json schema object with properties', () => {
    const schema = toolJsonSchema(echoTool)
    expect(schema).toMatchObject({ type: 'object', properties: { text: { type: 'string' } } })
  })
})

describe('defineTool', () => {
  it('infers handler args from params and runs', async () => {
    const tool = defineTool({
      name: 'demo_shout',
      description: 'uppercase input',
      params: { text: z.string() },
      readOnly: true,
      handler: async (args) => args.text.toUpperCase(),
    })
    expect(await tool.handler({ text: 'hi' }, {} as never)).toBe('HI')
  })

  it('rejects unknown param access at the type level', () => {
    defineTool({
      name: 'demo_shout',
      description: 'uppercase input',
      params: { text: z.string() },
      readOnly: true,
      handler: async (args) => {
        // @ts-expect-error text is the only declared param
        return args.missingProp
      },
    })
  })
})

describe('compiled tools', () => {
  it('definePlugin attaches jsonSchema per tool', () => {
    const p = definePlugin({ tools: [echoTool] })
    expect(p.tools[0].jsonSchema).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    })
  })

  it('validate returns parsed data on success', () => {
    const p = definePlugin({ tools: [echoTool] })
    const r = p.tools[0].validate({ text: 'hi' })
    expect(r).toEqual({ ok: true, data: { text: 'hi' } })
  })

  it('validate returns issues with paths on failure', () => {
    const p = definePlugin({ tools: [echoTool] })
    const r = p.tools[0].validate({ text: 42 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issues[0]).toMatch(/^text: /)
    }
  })

  it('validate treats undefined args as empty object', () => {
    const noArgs = defineTool({
      name: 'demo_ping',
      description: 'ping',
      params: {},
      readOnly: true,
      handler: async () => 'pong',
    })
    const p = definePlugin({ tools: [noArgs] })
    expect(p.tools[0].validate(undefined)).toEqual({ ok: true, data: {} })
  })
})
