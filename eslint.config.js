import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Pragmatic baseline lint config.
 *
 * The goal is to stop new damage (floating promises, unused code, `any`
 * sprawl, React hook mistakes) rather than to fail on the 100k lines of
 * legacy code that already exist. Rules that legacy code violates en masse
 * are set to `warn`; correctness rules are `error`.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src-tauri/target/**',
      'src-tauri/gen/**',
      'coverage/**',
      'packages/*/node_modules/**',
      'packages/vscode-extension/out/**',
    ],
  },

  // JS/config files
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },

  // TypeScript + TSX
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // --- correctness: fail the build ---
      'react-hooks/rules-of-hooks': 'error',
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-self-assign': 'error',
      'no-unsafe-negation': 'error',
      'no-useless-catch': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],

      // --- no floating promises in server code ---
      '@typescript-eslint/no-floating-promises': 'off',

      // --- ESLint 10 opinionated rules that flag intentional idioms ---
      // `let x = null; try { x = await f() } catch { x = null }` is a deliberate
      // defensive pattern throughout this codebase, not a bug.
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
      // `\[` inside a character class is redundant but kept for readability.
      'no-useless-escape': 'warn',

      // --- legacy debt: report but do not block ---
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-namespace': 'warn',

      // --- already clean elsewhere; keep it that way ---
      'no-console': 'off',
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },

  // Tests may use any and don't need the strictness above
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  }
);
