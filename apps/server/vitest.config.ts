import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude:
      process.env.SKIP_LIVE_TESTS === '1' ? [...configDefaults.exclude, '**/*.live.test.ts'] : configDefaults.exclude,
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['../../tests/setup.ts'],
    // azurite tests hit one shared process, keep table names unique per suite instead of parallel isolation
    fileParallelism: false,
  },
})
