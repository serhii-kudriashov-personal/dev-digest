# specs — mcp

**What it should do.** Feature specifications: the source of truth for
implementation and acceptance. Read BEFORE writing any code for the feature.

One file per feature, kebab-case (prefix with the lesson when it helps, e.g.
`l05-mcp-server.md`). Suggested skeleton:

```
# <Feature>
## Why           the user problem, one paragraph
## Scope         what's in / what's explicitly out
## Contracts     tool names, arguments, response shapes
## Acceptance    checkable criteria, as a list
## Open questions
```

Shipped? Don't delete it — the spec stays as the record of what was agreed.

The spec for the package itself lives at the repo root: `../../specs/l05-mcp-server.md`.
