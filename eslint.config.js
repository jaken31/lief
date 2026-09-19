import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
  {
    languageOptions: {
      globals: { chrome: 'readonly', window: 'readonly', document: 'readonly', console: 'readonly' },
    },
    rules: {
      // The banner renders page-controlled strings. Markup sinks are banned outright,
      // not reviewed case by case. TRD §12.
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Use textContent — page-derived strings are hostile.' },
        { property: 'outerHTML', message: 'Use textContent — page-derived strings are hostile.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: 'Use textContent — page-derived strings are hostile.',
        },
      ],
    },
  },
);
