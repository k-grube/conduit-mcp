import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ['tests/**/*.test.{js,ts}', 'src/**/*.test.{js,ts}'],
    // SKIP_LIVE_TESTS=1 excludes live integration tests (set by .husky/pre-push)
    exclude:
      process.env.SKIP_LIVE_TESTS === '1'
        ? [...configDefaults.exclude, '**/*.live.test.{js,ts}']
        : configDefaults.exclude,
    setupFiles: ['../../../tests/setup.ts'],
  },
})
