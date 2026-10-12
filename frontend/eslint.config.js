import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'off',
      // Dialogs, popover search boxes and login forms legitimately take focus on open.
      'jsx-a11y/no-autofocus': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      // Design language (docs/DESIGN_LANGUAGE.md): no inline sizes/colours in TSX.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style'] ObjectExpression > Property[key.name='fontSize']",
          message: 'No inline fontSize: use a Text role or a var(--font-*) token in a CSS module.',
        },
        {
          selector: "JSXAttribute[name.name='style'] ObjectExpression > Property[key.name=/^(color|background|backgroundColor)$/] > Literal[value=/^#|^white$/]",
          message: 'No hardcoded colours: use var(--…) tokens.',
        },
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is only allowed inside TextBlock (src/ui/TextBlock).',
        },
      ],
    },
  },
  {
    files: ['src/ui/TextBlock/**/*.tsx'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
