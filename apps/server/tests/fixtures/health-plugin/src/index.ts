import { definePlugin, defineTool, z } from '@conduit-mcp/plugin-sdk'

export default definePlugin({
  tools: [
    defineTool({
      name: 'healthdemo_ping',
      description: 'ping',
      params: { text: z.string() },
      readOnly: true,
      handler: async (args) => args.text,
    }),
  ],
  // config-driven so tests can exercise both outcomes
  healthCheck: async (ctx) => {
    const cfg = await ctx.getConfig<{ healthy?: boolean }>()
    return cfg.healthy === false ? { ok: false, detail: 'down' } : { ok: true }
  },
})
