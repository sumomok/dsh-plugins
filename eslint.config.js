import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Workspace lint rules. Type-aware linting is deliberately off: `tsc -b` already
 * runs over every package with `strict` plus the extra checks in
 * tsconfig.base.json, so a second type-aware pass would repeat that work for
 * the same findings.
 */
export default tseslint.config(
  { ignores: ['**/lib/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'separate-type-imports' }],
      'eol-last': ['error', 'always'],
      'no-trailing-spaces': 'error',
      'quotes': ['error', 'single', { avoidEscape: true }],
      'semi': ['error', 'never'],
      'comma-dangle': ['error', 'always-multiline'],
      // A parameter a protocol requires but the body ignores is spelled with
      // a leading underscore (a plugin's no-op `apply(_ctx)` is the case).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Package scripts and build programs are plain Node programs rather than
    // compiled sources, so the two runtime globals they use are declared here
    // instead of pulling in a globals package for two names.
    files: ['packages/*/scripts/*.mjs', 'packages/*/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
)
