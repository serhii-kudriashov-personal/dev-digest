// Flat ESLint config for @devdigest/web.
//
// Scope is deliberately narrow: this config exists to make the ARCHITECTURE
// rules in `.claude/skills/frontend-ui-architecture/SKILL.md` machine-checked
// instead of review-checked. It is not a style linter — formatting is not its
// job, and stylistic rules are left off on purpose so the signal stays high.
//
// Every rule here is `error` and passes today. Two of them
// (`react-hooks/exhaustive-deps`, `no-restricted-imports`) started as `warn`
// because the codebase had known pre-existing violations; Phase 2 of the
// improvement plan cleared both, so nothing is downgraded any more.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  {
    // `src/vendor/**` is vendored and explicitly do-not-refactor (root
    // AGENTS.md), so linting it would only produce noise nobody may act on.
    ignores: ['node_modules/**', '.next/**', 'coverage/**', 'src/vendor/**', 'next-env.d.ts'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mjs}'],
    plugins: { 'react-hooks': reactHooks, import: importPlugin },
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
      },
    },
    rules: {
      // ---- React correctness -------------------------------------------------
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',

      // ---- Module boundaries (skill §3) -------------------------------------
      // Direction of dependency: shared code must never reach up into routes.
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/lib',
              from: './src/app',
              message:
                'src/lib is shared infrastructure — it must not import route code. Move the shared piece down into lib, or keep the logic in the route.',
            },
            {
              target: './src/components',
              from: './src/app',
              message:
                'A shared component must not import route-local code. Promote what it needs into src/ or pass it in as a prop.',
            },
            // Sibling top-level route sections are independent features: one
            // must not reach into another's tree. Promote to src/components/
            // instead (see client/INSIGHTS.md, findings-hover-card).
            {
              target: './src/app/agents',
              from: ['./src/app/repos', './src/app/settings', './src/app/onboarding'],
            },
            {
              target: './src/app/repos',
              from: ['./src/app/agents', './src/app/settings', './src/app/onboarding'],
            },
            {
              target: './src/app/settings',
              from: ['./src/app/agents', './src/app/repos', './src/app/onboarding'],
            },
            {
              target: './src/app/onboarding',
              from: ['./src/app/agents', './src/app/repos', './src/app/settings'],
            },
          ],
        },
      ],

      // NOTE: `import/no-cycle` is deliberately NOT enabled. It is the natural
      // guard for the barrel cycles the skill warns about in §7, but it walks
      // the whole module graph through the TS resolver and pushed a full lint
      // of this package past five minutes — too slow for a CI gate. The audit
      // confirmed zero chained barrels in owned code; revisit if that changes
      // (a periodic `dependency-cruiser` run is the cheaper place for it).

      // ---- Deep relative imports (skill §3) ---------------------------------
      // The `@/*` alias is configured in tsconfig and is now the only way route
      // code reaches `src/lib` and `src/components`.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../../*'],
              message:
                "Deep relative import — use the '@/' alias instead (e.g. '@/lib/hooks', '@/components/app-shell').",
            },
          ],
        },
      ],

      // ---- TypeScript --------------------------------------------------------
      // The codebase is already free of `any`; keep it that way.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  {
    // Package-root config files run in Node, not in the browser or in Next's
    // bundle, so they legitimately reach for `process`.
    files: ['*.mjs', '*.ts', '*.js'],
    languageOptions: {
      globals: { process: 'readonly', __dirname: 'readonly', module: 'writable' },
    },
  },

  {
    // Tests mock modules and assert on internals; the boundary rules are about
    // production wiring, and unused-expression style noise helps nobody here.
    files: ['**/*.test.{ts,tsx}', '**/test/**'],
    rules: {
      'import/no-restricted-paths': 'off',
      'no-restricted-imports': 'off',
    },
  },
);
