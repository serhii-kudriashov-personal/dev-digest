# @devdigest/web

The Next.js studio: repositories, PRs, diffs, findings, agent editor.

## Commands

`pnpm dev` (:3000) · `pnpm build` · `pnpm typecheck` · `pnpm test`
(vitest + jsdom with `fetch` mocked — no API and no browser needed)

## Map

| Path | What it is |
|---|---|
| `src/app/**/page.tsx` | App Router routes; pages stay thin |
| `src/app/**/_components/<Name>/` | feature logic plus its `*.test.tsx` |
| `src/components/app-shell/` | nav, breadcrumbs, `g`-then-key shortcuts |
| `src/components/diff-viewer/` | GitHub-like diff rendering |
| `src/lib/api.ts` | typed fetch client, `ApiError` |
| `src/lib/hooks/` | every TanStack Query hook, barrel in `index.ts` |
| `src/vendor/ui/` | vendored UI primitives (`@devdigest/ui`) |
| `messages/<locale>/` | next-intl strings, one file per feature |

## Conventions

- **Data flows through hooks in `lib/hooks/*`.** A raw `fetch` inside a
  component is forbidden; a new endpoint means a new hook in the matching
  domain file.
- **Every hook goes through `apiFetch`** so failures normalize into `ApiError`
  and the UI can branch on `status`.
- **A mutation must invalidate its query keys** in `onSuccess`, or the screen
  keeps rendering stale data.
- **No hard-coded UI strings** — everything through `next-intl`, keys live in
  `messages/en/<feature>.json`.
- **Logic belongs in `_components/<Name>/`**, not in `page.tsx`; the test sits
  next to the component.
- Tests never hit the network: mock `fetch`, don't start the API.

## Gotchas

- `src/vendor/shared` is a **copy** of the server's canonical contracts, and it
  has already drifted (missing `openrouter`, `AgentManifest`,
  `AgentVersionConfig`). Edit the canon in `server/src/vendor/shared` first,
  then port the change here.
- `NEXT_PUBLIC_API_BASE` defaults to `http://localhost:3001`; when the API is
  unreachable `apiFetch` throws an `ApiError` with `status: 0`.
- `messages/` already carries files for features from later lessons — many keys
  are unused on purpose.

## Read when

| Read | When |
|---|---|
| `README.md` | you need the route map and which API backs each screen |
| `src/vendor/ui/README.md` | using or adding a UI primitive |
| `../TESTING.md` | writing a component test |
| `docs/` | asking why a screen is built the way it is |
| `specs/` | implementing a new screen or UI feature |
| `INSIGHTS.md` | before changing hooks, caching, or contracts |
