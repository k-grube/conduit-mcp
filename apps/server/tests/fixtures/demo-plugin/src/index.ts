import { definePlugin, defineTool, z } from '@conduit-mcp/plugin-sdk'

export default definePlugin({
  tools: [
    defineTool({
      name: 'demo_echo',
      description: 'echo text back',
      keywords: ['echo', 'text'],
      params: { text: z.string() },
      readOnly: true,
      handler: async (args) => args.text,
    }),
    defineTool({
      name: 'demo_add',
      description: 'add two numbers',
      keywords: ['math', 'sum'],
      params: { a: z.number(), b: z.number() },
      readOnly: true,
      handler: async (args) => args.a + args.b,
    }),
    defineTool({
      name: 'demo_fail',
      description: 'always fails',
      params: {},
      readOnly: false,
      handler: async () => {
        throw new Error('boom')
      },
    }),
  ],
  routes: (router, _ctx) => {
    router.get('/ping', (_req, res) => {
      res.json({ pong: true })
    })
    router.post('/ping', (_req, res) => {
      res.json({ pong: true })
    })
    router.get('/callback', (_req, res) => {
      res.json({ ok: true, publicRoute: res.locals.publicRoute === true })
    })
    router.get('/private', (_req, res) => {
      res.json({ private: true, publicRoute: res.locals.publicRoute === true })
    })
  },
  jobs: [{ name: 'tick', intervalMs: 60000, run: async () => {} }],
  healthCheck: async () => ({ ok: true }),
})
