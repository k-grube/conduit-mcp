import { defineConfig } from 'vitest/config'

export default defineConfig({
  // vite 8 defaults to oxc over esbuild for transforms, oxc reads tsconfig's jsx: "preserve" otherwise
  oxc: { jsx: { runtime: 'automatic' } },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
})
