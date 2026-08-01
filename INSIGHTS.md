# Insights — repo-wide

Lessons that span the whole repo: what broke, why, and how not to step on it
twice. Package-level lessons live in `<pkg>/INSIGHTS.md`.

**Append-only, newest first.** Only write down what is NOT visible from the code
and what cost real time. Format:

```
## YYYY-MM-DD — title
**Symptom:** what was observed
**Cause:** what was actually going on
**Takeaway:** what to do next time
```

---

## 2026-08-01 — `@devdigest/shared` drifts silently between server and client

**Symptom:** the client's types don't know about the `openrouter` provider even
though the server fully supports it; `AgentManifest`, `AgentVersionConfig`,
`CommitFilesPayload` and the `sessionId` field are missing too.

**Cause:** the contracts are vendored twice — `server/src/vendor/shared` (canon)
and `client/src/vendor/shared` (copy). There is no sync script, and CI can't
catch the divergence because each package typechecks in isolation and both pass.

**Takeaway:** always edit the canon and port the change in the same commit.
Before touching contracts, check: `diff -r server/src/vendor/shared
client/src/vendor/shared`.

---

## 2026-08-01 — `costUsd` reaches the server and dies there

**Symptom:** cost is computed in the adapters and accumulated by the engine, but
never surfaces anywhere.

**Cause:** commit `d45ab0d` removed the consumer (per-run cost) and left the
producer in place. This is intentional — the cost badge returns in L01.

**Takeaway:** don't "fix" it as a forgotten wire and don't delete it as dead
code.
