import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import eslintConfigPrettier from 'eslint-config-prettier'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    // source files only, generated output excluded so a full-repo run stays fast
    ignores: [
      '**/dist/',
      '**/build/',
      '**/node_modules/',
      '.dev/',
      '.superpowers/',
      '**/.next/',
      '**/out/',
      'apps/web/next-env.d.ts',
      '**/.turbo/',
      '**/coverage/',
      '**/storybook-static/',
      '**/*.min.{js,mjs,cjs}',
      '**/*.bundle.js',
      '**/*.d.ts.map',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/ban-ts-comment': 'warn',
      curly: ['error', 'all'],
      'no-nested-ternary': 'error',
      // none of this `;(expr).method()`. semi: 'never' rules out trailing
      // `;`, semi-style: 'last' rules out leading `;`. together they force a
      // restructure (extract temp, fix the underlying cast, etc.) rather than
      // letting a defender semi slip in
      semi: ['error', 'never', { beforeStatementContinuationChars: 'never' }],
      'semi-style': ['error', 'last'],
      'no-extra-semi': 'error',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: {
        module: 'writable',
        require: 'readonly',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: ['src/**/*.{js,cjs,mjs,ts}', '**/scripts/**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        // node 22+ web globals, eslint doesn't infer this from package.json engines
        URLSearchParams: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
  },
)
