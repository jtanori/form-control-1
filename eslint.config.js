import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/*.config.*',
      '**/playwright-report/**',
      '**/test-results/**',
      'packages/extension/dist/**',
      'packages/extension/public/vad/**',
      'packages/extension/test/browser/.bundle/**',
      'node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, chrome: 'readonly' },
    },
    plugins: { import: importPlugin },
    settings: {
      'import/resolver': {
        node: { extensions: ['.js', '.ts', '.tsx'] },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'no-console': 'warn',
    },
  },
  {
    // Acceptance criterion E-1: untrusted strings (STT output, model output,
    // page text) must never be assigned as markup.
    files: ['packages/extension/src/content/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'document',
          property: 'write',
          message: 'Content scripts must render with DOM APIs.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'AssignmentExpression > MemberExpression.left[property.name=/^(inner|outer)HTML$/]',
          message: 'Use textContent/DOM builders: content-script text is untrusted.',
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: 'Use textContent/DOM builders: content-script text is untrusted.',
        },
      ],
    },
  },
  {
    files: ['packages/brain/**/*.ts', 'scripts/**/*.mjs', '**/scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'vitest.setup.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);
