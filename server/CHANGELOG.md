# @devdigest/api

The HTTP API consumed by the studio client and the CI runner. Versioned
independently of the repo; consumers pin a `^` range.

## 1.3.0 — 2026-08-06

### Minor Changes

- `GET /pulls/:id/runs` payload normalized: `findings_count` is now `findings`,
  and `duration_ms` is emitted in whole seconds instead of milliseconds.
- `grounding` dropped from the run summary — it was only ever a debug string and
  no screen renders it.
- `GET /pulls/:id/runs` takes an explicit `?status=` so callers ask for the slice
  they want rather than filtering the whole history client-side.

### Patch Changes

- Long run histories serialize smaller.

## 1.2.0 — 2026-07-28

### Minor Changes

- `score` and `blockers` added to the run summary, denormalized at completion.
