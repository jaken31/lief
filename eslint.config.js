import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { chrome: 'readonly', window: 'readonly', document: 'readonly', console: 'readonly' },
    },
    rules: {
      // The banner must never take page-controlled strings as markup. See TRD §12.
      'no-restricted-properties': [
        'error',
        { object: 'element', property: 'innerHTML', message: 'Use textContent — page strings are hostile.' },
      ],
    },
  },
);
