# Spec: GitLab repositories

Spec ID: SPEC-06
Created: 2026-08-28
Status: draft
Supersedes: None

## Problem and user

A DevDigest operator whose team hosts its code on GitLab cannot use the product
at all. Repository import validates the submitted URL by exact host equality
against a single constant and rejects everything else
(`server/src/modules/repos/helpers.ts:45-47`), so the first screen of the
onboarding flow is also the last one they see. There is no partial path: a
GitLab team cannot review a merge request in DevDigest, cannot get findings
posted back, and cannot mix a GitLab project with a GitHub one in a shared
workspace. Today their only options are to move their code or to not use the
product.

The cost is not only "GitLab is missing". A large share of GitLab usage is
**self-managed** — an instance at an arbitrary host, often on a private network,
sometimes on a non-default port or behind a path prefix. For those operators the
product's single-host assumption is not a small gap to widen but the whole shape
of how a repository is identified, how it is authenticated, and where a link
points. Meanwhile the assumption is baked into places nobody would look for it:
the word "GitHub" appears in seven user-visible copy catalogues, the import
screen's guidance is hard-coded English outside the translation catalogue
entirely (`client/src/app/onboarding/_components/AddRepoView/AddRepoView.tsx:79,94,99`),
every deep-link is built from one constant (`client/src/lib/github-urls.ts:5`),
and the on-disk clone location is derived from two path segments and reused
whenever a clone already exists there (`server/src/adapters/git/simple-git.ts:37-61`).

## Goals / Non-goals

**Goals**

- An operator can register one or more GitLab instances — gitlab.com and
  self-managed alike, with gitlab.com being just another instance rather than a
  special case — each with its own credential, and see that DevDigest can talk
  to it.
- A user can import a GitLab project from any registered instance, browse its
  open merge requests, their diffs, files, commits, linked issue and existing
  inline discussion, and run the review agents against them.
- A review run's summary and inline findings are posted back onto the merge
  request, and the run's verdict is reflected there as far as GitLab's own API
  allows — with the shortfall stated rather than hidden.
- One workspace holds GitHub and GitLab repositories at the same time, and every
  identifier, label and outbound link is correct for the repository it belongs
  to.
- Everything an existing GitHub user has imported keeps working, unchanged and
  without a re-import.

**Non-goals**

- **Export-to-CI parity (SPEC-05) for GitLab.** Generating a pipeline
  definition, ingesting pipeline runs and reading job artifacts are out of
  scope. What is in scope is that the export entry point says so instead of
  failing. A follow-up spec may add parity; nothing here is designed to block
  it.
- **Enforcing** a merge request's approval requirements, reading approval rules,
  code-owner gating or an aggregate approval state. Those are licensed features
  and DevDigest makes no promise about them.
- Bitbucket, Gitea, Azure DevOps or any other provider.
- Changing how a review is produced. The review engine computes its verdict with
  no knowledge of the provider (`reviewer-core/src/output/to-review.ts:155-160`)
  and this feature does not touch it, `reviewer-core/src/grounding.ts` or the
  prompt injection guard.
- SSH-form repository URLs for GitLab instances. Import is over https only.
- Migrating an existing GitHub repository row to a different provider.

## User stories

- **US-1** — As an operator, I want to register a GitLab instance by its base
  URL and a credential, so that repositories on it can be imported.
- **US-2** — As an operator, I want to know what DevDigest found on the other
  end of that base URL, so that I can tell a working connection from a
  half-working one before anyone imports a project.
- **US-3** — As a reviewer, I want to import a GitLab project by pasting its
  URL, so that its open merge requests appear in DevDigest.
- **US-4** — As a reviewer, I want a merge request's detail, diff and existing
  inline discussion to read exactly like a pull request's, so that I do not have
  to learn two products.
- **US-5** — As a reviewer, I want a review run's summary and inline findings
  posted onto the merge request, so that my team sees them where they already
  work.
- **US-6** — As a reviewer, I want the run's verdict reflected on the merge
  request as far as GitLab allows, and the shortfall stated when it is not, so
  that "approve" and "request changes" keep meaning something.
- **US-7** — As a reviewer working across both providers in one workspace, I
  want every label, identifier and outbound link to be correct for the
  repository it belongs to, so that I never open the wrong system or read the
  wrong code.
- **US-8** — As an existing GitHub user, I want nothing about my imported
  repositories to change, so that gaining GitLab support costs me nothing.
- **US-9** — As a reviewer with a GitLab repository, I want the export-to-CI
  entry point to tell me it is unavailable rather than fail halfway, so that I
  am not left guessing what happened.

## Acceptance criteria (EARS)

### Registering an instance

**AC-1** — WHEN an operator submits a GitLab instance's base URL and credential,
the system shall verify the credential against that instance before the instance
becomes available for repository import.
  *Verification:* an instance whose verification has not succeeded is absent
  from the set of instances the import screen offers.

**AC-2** — IF the submitted base URL's scheme is not `https`, THEN the system
shall reject the registration and state that only TLS-protected instances are
supported.
  *Verification:* submitting an `http://` base URL in Settings leaves no
  instance registered and shows that reason.

**AC-3** — IF the instance's TLS certificate does not validate against the
host's trust store, THEN the system shall reject the registration with the
certificate as the stated reason.
  *Verification:* registering an instance with a self-signed certificate shows a
  certificate-specific message, distinct from "unreachable" and from "invalid
  credential".

**AC-4** — IF the submitted base URL's host is an IP literal, or resolves to a
loopback, link-local, unique-local or private-range address, THEN the system
shall reject the registration and name the rejected host.
  *Verification:* the rejection happens at registration time in Settings, before
  any repository exists, and the message contains the host that was rejected.

**AC-5** — IF the submitted base URL carries a username or password component,
THEN the system shall reject the registration rather than use those credentials.
  *Verification:* a base URL of the form `https://user:pass@host/` leaves no
  instance registered.

**AC-6** — The system shall accept a registered instance base URL bearing a
non-default port, a path prefix of any depth, or both, and shall treat that base
URL as opaque when addressing the instance.
  *Verification:* an instance registered at a base URL with a port and a
  two-segment path prefix lists merge requests and produces working links.

**AC-7** — WHEN verification succeeds, the system shall report the instance's
detected version and edition.
  *Verification:* both values are visible on the instance's entry in Settings
  after a successful test.

**AC-8** — WHILE an instance's approval capability has not been established, the
system shall present that capability as unknown.
  *Verification:* the instance's entry in Settings shows an explicitly unknown
  approval capability, never a claim that approvals are unavailable.

**AC-9** — IF a capability probe against an instance returns a not-found answer,
THEN the system shall record that capability as unknown rather than as absent.
  *Verification:* a not-found probe result leaves the capability in the same
  state as a probe that was never run — the two are indistinguishable to the
  user by design, because the instance's answer is ambiguous.

**AC-10** — The system shall exclude a stored instance credential from every API
response, error message and user-visible string.
  *Verification:* no response or message produced by any instance, import,
  sync, or post-back path contains the credential's characters.

**AC-11** — IF an outbound request to a registered instance is answered with a
redirect to a different origin, THEN the system shall treat that request as
failed without following the redirect.
  *Verification:* an instance that redirects elsewhere is reported unreachable
  and no request reaches the redirect target.

**AC-12** — The system shall present the connection test result per registered
instance.
  *Verification:* with two instances registered, testing one reports a result
  naming that instance and leaves the other's result untouched.

### Importing and identifying a repository

**AC-13** — WHEN a user submits a repository URL whose origin exactly matches a
registered GitLab instance, the system shall import the project identified by
the remainder of the path as its namespace path, at any depth.
  *Verification:* a project at `group/subgroup/team/project` on a registered
  instance imports and is listed under that full path.

**AC-14** — IF a submitted repository URL's origin matches neither a registered
GitLab instance nor the supported GitHub host, THEN the system shall reject the
import and name the instances that are available.
  *Verification:* the rejection message on the import screen lists the
  registered instances, and no repository row and no local clone is created.

**AC-15** — The system shall record, for every repository, which instance it
belongs to.
  *Verification:* the value is present on every repository the API returns,
  including repositories imported before this feature.

**AC-16** — The system shall permit the same namespace path to exist once per
instance within one workspace.
  *Verification:* importing `acme/api` from two different registered instances
  into one workspace yields two repositories; importing it twice from the same
  instance yields one.

**AC-17** — The system shall give two repositories with the same namespace path
on different instances distinct local clone locations.
  *Verification:* after importing the same namespace path from two instances,
  the two repositories report different clone locations, and the code reviewed
  under each is that instance's code.

**AC-18** — IF the local clone location chosen for an import already holds a
clone of a different remote, THEN the system shall fail the import without
fetching into that clone.
  *Verification:* the pre-existing clone's remote and working tree are
  unchanged after the failed import, and the failure names the collision. This
  is the criterion that keeps the mirror's hard-reset-on-sync behaviour (root
  `INSIGHTS.md` 2026-08-16) from destroying another repository's clone.

**AC-19** — The system shall keep every repository imported before this feature
listed, syncable and reviewable without a re-import, and shall report its
provider as GitHub.
  *Verification:* an existing workspace's repositories behave identically before
  and after the feature ships, with no user action required.

### Browsing a merge request

**AC-20** — WHEN a GitLab repository is synced, the system shall list its open
merge requests carrying the same fields the change-request list already shows
for GitHub.
  *Verification:* title, author, branch, base, head revision, added and removed
  line counts, changed-file count and status are all populated in the list for a
  GitLab repository.

**AC-21** — The system shall identify a merge request by its project-scoped
internal identifier, and shall use that same identifier in the UI and in every
outbound link.
  *Verification:* the number shown in DevDigest for a merge request equals the
  number in that merge request's own web URL on the instance.

**AC-22** — The system shall populate a merge request's linked issue from the
instance's own answer about which issues the merge request closes, and shall
report no linked issue when that answer is empty.
  *Verification:* a merge request whose description closes an issue shows that
  issue; one that closes none shows no linked issue rather than an empty
  placeholder.

**AC-23** — The system shall identify an inline comment and its thread by a
string identifier for every provider.
  *Verification:* the identifier fields on an inline comment are strings for
  both a GitHub pull request and a GitLab merge request, and a reply posted
  against a GitLab thread lands in that thread.

**AC-24** — WHILE an inline note's stored diff-revision identifiers are not
among the merge request's current diff revisions, the system shall mark that
note as outdated.
  *Verification:* the outdated marker appears on the merge request's inline
  discussion for a note left against a superseded revision, in the same place
  the GitHub equivalent appears. GitLab exposes no outdated flag of its own, so
  this state is derived — the derivation rule differs per provider while the
  meaning of the marker does not.

**AC-25** — IF a link target received from an instance does not share that
instance's registered origin, THEN the system shall not render it as a link.
  *Verification:* an instance answering with an off-origin or non-`https` link
  target produces no clickable element for it.

### Vocabulary, labelling and outbound links

**AC-26** — WHERE a repository belongs to a GitLab instance, the system shall
name its change requests "merge request" and prefix their identifier with `!`.
  *Verification:* the list, header and every reference to a GitLab change
  request read "merge request" and `!42`.

**AC-27** — WHERE a repository belongs to GitHub, the system shall name its
change requests "pull request" and prefix their identifier with `#`.
  *Verification:* nothing about the wording of a GitHub repository's screens
  changes from what shipped before this feature.

**AC-28** — The system shall present no user-visible string naming GitHub on a
screen scoped to a repository belonging to a GitLab instance.
  *Verification:* the empty change-request list, the remove-repository
  confirmation, the open-externally actions and the settings copy all read
  correctly for a GitLab repository.

**AC-29** — The system shall build every outbound link to a change request, a
file, or a line range from the owning repository's instance base URL.
  *Verification:* on an instance registered at a non-default port with a path
  prefix, a finding's file link opens that instance's own file view.

**AC-30** — WHEN the system produces a line-range link for a repository, it
shall use the line-range fragment form of that repository's provider.
  *Verification:* the fragment for a GitLab repository's two-line range differs
  from the GitHub form — GitLab writes the end line without repeating the line
  marker — and both open at the intended range.

**AC-31** — The system shall carry a repository's provider and instance as text
in the repository card, the change-request list row and the change-request
header.
  *Verification:* the provider and instance are readable as text in all three
  places, and are part of the element's accessible name rather than conveyed by
  an icon or a colour alone.

**AC-32** — The system shall present the repository-import guidance without
naming a single provider, and shall source that guidance from the translation
catalogue.
  *Verification:* the import screen's label, hint and placeholder change when
  the catalogue changes, and none of them names one provider.

**AC-33** — WHILE a repository's namespace path is longer than the space
available, the system shall show its trailing segments and make the full path
available on demand.
  *Verification:* a four-segment namespace path in a list row shows the project
  and its nearest groups, and the whole path is obtainable without leaving the
  screen.

### Posting a review back

**AC-34** — WHEN a review run is posted to a GitLab merge request, the system
shall publish the run's summary as a merge-request-level note and each inline
finding as a diff note anchored to its file and line.
  *Verification:* after posting, the merge request carries one summary note and
  one inline note per published finding, each on the file and line the finding
  names.

**AC-35** — The system shall anchor a GitLab diff note using the merge request's
diff revision identifiers together with the file's old and new path, expressing
an added line by its new-side line number and a removed line by its old-side
line number.
  *Verification:* a finding on an added line appears against the added line and
  a finding on a removed line against the removed line, with no note landing on
  the wrong side.

**AC-36** — WHERE the run's verdict is `approve`, the system shall additionally
request approval of the merge request.
  *Verification:* a clean run against a merge request the credential may approve
  leaves that merge request approved by the credential's identity.

**AC-37** — WHERE the run's verdict is `request_changes` and the merge request
currently carries DevDigest's approval, the system shall withdraw that approval.
  *Verification:* a merge request previously approved by DevDigest is no longer
  approved by it after a `request_changes` run.

**AC-38** — IF an approval or a withdrawal is refused, THEN the system shall
state the reason alongside the posted notes.
  *Verification:* a credential whose identity is not an eligible approver
  produces a stated reason on the run's outcome, and the notes remain posted.

**AC-39** — The system shall present the outcome of posting to a GitLab merge
request as exactly one of: posted with the verdict applied, posted without the
verdict applied, or partially published.
  *Verification:* the run's outcome on the review screen is one of those three
  and never a bare success or a bare failure.

**AC-40** — IF publishing the notes fails after at least one note has been
published, THEN the system shall report the outcome as partially published.
  *Verification:* interrupting publication mid-way leaves the run's outcome
  distinguishable from both a complete post and a post that never started.

**AC-41** — WHERE the run's verdict is `request_changes`, the system shall state
that GitLab carries the verdict in the summary note rather than as a review
state.
  *Verification:* the outcome shown for a `request_changes` run on a GitLab
  merge request says so in words — this is a deliberate, stated downgrade from
  GitHub parity, not an equivalence.

### Syncing, degradation and errors

**AC-42** — The system shall record the last successful sync time per
repository.
  *Verification:* two repositories on two instances show independent
  last-synced times.

**AC-43** — IF one instance is unreachable during a polling cycle, THEN the
system shall complete that cycle for repositories on every other instance.
  *Verification:* with one instance offline, repositories on the others have a
  newer last-synced time after the cycle.

**AC-44** — WHILE a repository's most recent sync attempt failed, the system
shall present its change-request list as a snapshot with the failure stated.
  *Verification:* the list is visibly distinct from a repository that genuinely
  has no open change requests and from a list still loading.

**AC-45** — IF an instance rejects the stored credential, THEN the system shall
name the instance that rejected it and state that the credential must be able to
read merge requests and post notes.
  *Verification:* the message names one instance and describes the capability
  needed in behavioural terms, not as a list of scope names.

**AC-46** — IF an instance does not provide something DevDigest requires, THEN
the system shall state the instance's detected version alongside the failure.
  *Verification:* the failure message carries the version reported at
  verification time, so an operator can tell "too old" from "misconfigured".

**AC-47** — WHILE the selected repository belongs to a GitLab instance, the
system shall present the export-to-CI entry point as unavailable for that
provider.
  *Verification:* the entry point is reachable, states the reason, and offers no
  action.

**AC-48** — IF an export-to-CI request names a repository belonging to a GitLab
instance, THEN the system shall refuse it with a stated reason.
  *Verification:* the refusal happens before anything is generated or committed
  anywhere.

## Edge cases

| Case | Decided behaviour |
|---|---|
| Same namespace path on two instances | Two distinct repositories, two distinct clone locations (AC-16, AC-17). |
| Clone location already holds another remote | Import fails, existing clone untouched (AC-18). |
| Namespace nested four or more levels deep | Accepted at any depth; the list truncates from the front and exposes the whole path on demand (AC-13, AC-33). |
| Instance base URL has a port and a deep path prefix | Accepted; the base URL is opaque and everything is derived from it (AC-6, AC-29). |
| Instance is on a private network | Rejected at registration (AC-4). This deliberately excludes some legitimate internal instances; see Open question 6. |
| Instance uses a private certificate authority | Rejected as a certificate failure (AC-3); see Open question 6. |
| Credential is not an eligible approver | The common approval failure. Notes post, verdict not applied, reason stated (AC-38, AC-39). |
| Instance cannot approve at all | Rare, not the common case: approvals are available on GitLab's free tier. Handled by the same three-state outcome, never predicted at setup (AC-8, AC-9, AC-39). |
| Verdict is `request_changes` | Approval withdrawn if DevDigest holds one, and the downgrade stated in words (AC-37, AC-41). |
| Publication interrupted mid-way | Reported as partially published (AC-40). |
| Inline note against a superseded diff revision | Marked outdated by DevDigest's own comparison, since the instance exposes no such flag (AC-24). |
| Merge request closes no issue | No linked issue, not an empty placeholder (AC-22). |
| One instance offline, others up | Cycle completes for the others; the offline one's repositories show a stated stale snapshot (AC-43, AC-44). |
| Instance reports its rate limit exhausted | Requests to that instance pause until the reported reset; other instances are unaffected (NFR-10, NFR-11). |
| Instance answers with an off-origin link | Not rendered as a link (AC-25). |
| Export-to-CI on a GitLab repository | Stated unavailable, refused server-side too (AC-47, AC-48). |
| Workspace with zero GitLab instances | Unchanged from today: GitHub import works, and the import screen's guidance is provider-neutral (AC-19, AC-32). |
| Repository imported before this feature | Reported as GitHub, works unchanged, no re-import (AC-19). |
| Two simultaneous imports of one URL | At most one repository (NFR-9). |
| Two simultaneous posts of one run | At most one published set of notes (NFR-8). |

## Design & UX review

**Design artefacts reviewed:** none were supplied. The design source is the
**shipped GitHub integration** as of commit `261bbf7` on branch
`feature/gitlab`, which carries zero diff against `main` — nothing had been
built. That makes the shipped UI a baseline to review, not a target to copy: its
single-provider assumptions are exactly what this spec has to name.

All twelve checklist rows, including the ones that were fine:

| # | Check | Verdict | Finding, and where it landed |
|---|---|---|---|
| 1 | Empty state | **gap** | The empty change-request list says "Refresh to sync from GitHub" (`client/messages/en/prReview.json:131`); the remove-repository confirmation and settings copy name GitHub too (`shell.json:14`, `settings.json:55`); the import screen tells the user to paste a *GitHub* URL in hard-coded English (`AddRepoView.tsx:79,94,99`). → AC-28, AC-32. |
| 2 | Loading | **covered** | Import is already an asynchronous clone job with a pending state; a slower self-managed instance is not a new state. One addition only: verification needs its own bounded wait. → NFR-1, NFR-2. |
| 3 | Partial / degraded | **gap** | Posting is not atomic on GitLab: notes and the verdict are separate actions, so "posted but not approved" and "partially published" are ordinary outcomes with no design. **Corrected from the intake:** approvals are a **free-tier** feature, so "this instance cannot approve at all" is rare — the realistic failure is that the credential's identity is not an eligible approver. Export-to-CI is a third degradation. → AC-38, AC-39, AC-40, AC-41, AC-47, AC-48. |
| 4 | Error, per source | **gap** | Four distinct failures needed four messages and had one, naming a single host (`server/src/modules/repos/helpers.ts:46`): unregistered origin, unreachable or untrusted instance, rejected credential, missing capability. → AC-3, AC-11, AC-14, AC-45, AC-46. |
| 5 | Overflow | **gap** | Namespaces nest arbitrarily, so a two-segment path shape does not hold (`helpers.ts:51` requires exactly two) and no truncation rule existed for a long path. → AC-13, AC-33, NFR-4. |
| 6 | Stale | **gap** | Polling is one global interval (`server/src/vendor/shared/contracts/platform.ts:93`) while rate limits and reachability are per instance; gitlab.com's fixed limits are not inherited by a self-managed instance, which ships its own administrator-configured values. The existing asymmetric-staleness pattern (`client/INSIGHTS.md` 2026-08-09) still applies to the panels themselves. → AC-42, AC-43, AC-44, NFR-10, NFR-11. |
| 7 | Permission / ownership | **gap** | Read, write and approve are separately gated by token capability and project role. **Corrected from the intake:** the tier is not the barrier — the barrier is eligibility to approve, and by default the merge request's own author is not an eligible approver. GitHub's single documented scope string (`settings.json:15`) does not generalise, and GitLab documents no per-endpoint scope mapping, so the copy must stay behavioural. → AC-38, AC-45. |
| 8 | Zero / one / many | **gap** | Settings draws exactly one GitHub card (`settings.json:49-55`) and the secrets status is a fixed object with one boolean per provider (`platform.ts:131`). N instances each with a credential makes zero, one and many three different screens, and a connection test must name *which* instance. → AC-1, AC-7, AC-12. |
| 9 | Navigation and focus | **gap** | Every deep-link derives from one constant with GitHub's path shapes (`client/src/lib/github-urls.ts:5,17,31`), consumed by five surfaces. GitLab's shapes differ, including a trap: its line-range fragment omits the repeated line marker that GitHub writes. A specific note has no canonical path of its own on GitLab. In-app focus behaviour from L04 and L06 is provider-independent and unaffected. → AC-29, AC-30, Open question 5. |
| 10 | Copy and i18n | **gap** | "GitHub" is a literal in `shell.json:14,42,43`, `settings.json:14,49-55`, `prReview.json:131`, `blast.json:33`, `ci.json:49-50`, and the import screen's strings are outside the catalogue entirely. → AC-28, AC-32. |
| 11 | Accessibility | **gap** | A new provider distinction must not be carried by an icon or a colour alone — the same standing rule as the severity chips. → AC-31. |
| 12 | Truthfulness | **gap, three** | (a) A github.com link rendered for a merge request is a confident falsehood → AC-25, AC-29, AC-30. (b) The inline-comment outdated flag is documented as GitHub's own rule (`platform.ts:239`); GitLab exposes no equivalent, so the flag keeps its meaning and gains a per-provider derivation → AC-24. (c) **Sharpest obligation in the feature:** the clone location is `cloneDir/owner/name` and an existing directory containing a clone is reused rather than re-cloned (`server/src/adapters/git/simple-git.ts:37-61`), so the same namespace path on two instances would review the wrong repository's code while naming the right one — and because the clone is a mirror that hard-resets on sync, the damage is not read-only → AC-17, AC-18. |

**UX improvements proposed and accepted:** the provider and instance become a
text-labelled attribute in three places rather than something inferred from a
URL (AC-31); the import screen's guidance becomes provider-neutral and
translatable (AC-32); and instance verification reports what it *detected*
rather than a bare pass/fail (AC-7).

**One improvement proposed and cut back on evidence.** Verification was to
report whether approvals are available. It cannot honestly do that: the licensed
tier is not readable by a non-administrator credential, and the one tier-gated
probe returns the same not-found answer for "not licensed" and "not permitted".
So verification reports version and edition — both reliably available — and
approval capability stays **probed, never asserted**, with the ambiguous answer
recorded as *unknown* (AC-8, AC-9). The honest design is to attempt the approval
and report the three-state outcome (AC-39), not to predict availability at
setup.

## Workflows and contracts

### 1. Registering an instance, then importing a repository

```mermaid
sequenceDiagram
  participant Operator
  participant Studio as DevDigest Studio
  participant API as DevDigest API
  participant Instance as GitLab instance
  participant Clone as Local clone

  Operator->>Studio: register instance, base URL and credential
  Studio->>API: verify this instance
  API->>API: is this base URL admissible
  alt not admissible
    API-->>Studio: rejected, with the reason
  else admissible
    API->>Instance: who am I, and what version and edition are you
    Instance-->>API: identity, version, edition
    API->>Instance: probe approval capability
    Instance-->>API: permitted, refused, or ambiguous
    API-->>Studio: verified, with version, edition, capability
  end

  Operator->>Studio: import this repository URL
  Studio->>API: import request
  API->>API: does this origin match a registered instance
  alt no match
    API-->>Studio: rejected, naming available instances
  else match
    API->>Clone: place this project at a location unique to its instance
    Clone-->>API: placed, or collision
    API->>Instance: list this project's open merge requests
    Instance-->>API: merge requests
    API-->>Studio: repository imported, merge requests listed
  end
```

### 2. What posting a review to a merge request can end as

```mermaid
stateDiagram-v2
  [*] --> Publishing : review run posted
  Publishing --> PartiallyPublished : publication interrupted after a note landed
  Publishing --> Published : summary and inline notes all landed
  Publishing --> NotPosted : nothing landed
  Published --> VerdictApplied : approval accepted, or withdrawal accepted
  Published --> VerdictNotApplied : approval refused, or not eligible
  Published --> VerdictInNoteOnly : verdict is request changes
  VerdictApplied --> [*]
  VerdictNotApplied --> [*]
  VerdictInNoteOnly --> [*]
  PartiallyPublished --> [*]
  NotPosted --> [*]
```

`VerdictNotApplied` and `VerdictInNoteOnly` are both reported to the user as
"posted without the verdict applied" (AC-39), with their own reason text
(AC-38, AC-41). `NotPosted` is the ordinary failure that already exists for
GitHub.

### 3. Contract promises

Each row is what crosses a boundary and what the consumer may rely on. The
shared contracts exist in **two copies** — `server/src/vendor/shared/**` is
canonical and `client/src/vendor/shared/**` is a manual copy that is already
known to drift (root `INSIGHTS.md` 2026-08-01, 2026-08-02) — so every promise
below holds identically in both, or it holds in neither.

| Hop | Carries | On producer failure | Freshness |
|---|---|---|---|
| Studio → API: register instance | a base URL and a credential | one of the typed rejections of AC-2…AC-5, AC-11; no instance registered | n/a |
| API → instance: verification | the credential | rejected, unreachable, or certificate-untrusted, each distinct | one-shot, re-runnable per instance |
| Studio → API: import repository | a repository URL | rejected naming the available instances (AC-14), or a collision (AC-18); no repository and no clone left behind | n/a |
| API → instance: list and detail merge requests | a project path and an internal identifier | the last synced snapshot with the failure stated, per repository (AC-44) | as of that repository's last successful sync (AC-42) |
| API → instance: publish a review | a summary, inline notes with their anchors, and optionally a verdict action | one of the three outcomes of AC-39 | immediate |
| API → store: repository | its instance, its namespace path, its clone location | import fails whole | authoritative |
| Studio → instance web UI | a link built from the owning instance's base URL | an off-origin target is not rendered at all (AC-25) | as of render |
| MCP tool result → another model | provider-neutral wording for a change request | unchanged from today | as of call |

**Fields that carry meaning, and what old records are promised.**

| Promise | Detail |
|---|---|
| A repository's instance | Present on **every** repository the API describes, including every repository that already exists — for those, it is the supported GitHub host (AC-15, AC-19). No repository is ever described without it. |
| A repository's namespace path | The full path, of any depth. The existing two-part owner/name description remains meaningful for GitHub repositories and for a GitLab project whose namespace happens to be one level deep; consumers that need the whole path must read the path, not reassemble it from two parts. |
| A change request's number | **Unchanged, and no migration is required.** A merge request's project-scoped internal identifier is an integer unique within its project, and the store already keys a change request by its repository plus that integer (`server/src/db/schema/pulls.ts:16,31`). It is also the number that appears in the merge request's own web URL, so AC-21 is satisfied by what already exists. A planner should not invent a new identifier for this. |
| An inline comment's identity | The comment identifier and the reply-to identifier are **strings** for every provider (AC-23). GitHub's integers stringify without loss; GitLab's thread identifiers are opaque strings and do not reverse into integers, so a string is the only shape that carries both rather than a compromise. These records are fetched live per request (`server/src/modules/pulls/routes.ts:344`) and are not persisted in any table, so widening them promises nothing about stored data. |
| An inline comment's outdated marker | Keeps its meaning — "this note no longer anchors to the current diff" — and gains an explicitly per-provider derivation. Its current description as GitHub's own rule (`server/src/vendor/shared/contracts/platform.ts:239`) stops being true of the field as a whole and must stop claiming to be. |
| A post-back outcome | Three states, not a boolean (AC-39), each with its own reason text. This is a new required piece of information about a review run, so it belongs beside the run's result rather than inside a document already written to disk for existing runs (root `INSIGHTS.md` 2026-08-11). |
| An instance's detected version, edition and approval capability | Version and edition are facts read from the instance. Capability is one of permitted, refused, or **unknown** — and unknown is a first-class value, not a missing one (AC-8, AC-9). |
| A connection test | Names an instance, not a provider (AC-12). The existing closed set of testable providers cannot express "this instance of many". |

## Non-functional requirements

| NFR | Requirement | Verification |
|---|---|---|
| **NFR-1** | Instance verification shall return a result to the operator within **10 s**, or report a timeout. | The Settings entry leaves its pending state within 10 s in every case, success or failure. |
| **NFR-2** | Any single outbound request to an instance shall be abandoned at **30 s**, and its caller shall receive a stated failure rather than continue waiting. | No screen stays pending past 30 s on an unresponsive instance; the clone job's own asynchronous behaviour is unchanged. |
| **NFR-3** | The inline notes published for one review shall be capped at the same limit already applied when posting to GitHub, and the user shall be told when that cap truncated the post. | A review with more findings than the cap posts the cap's worth and says so. |
| **NFR-4** | The system shall impose **no depth limit of its own** on a namespace path; a path is limited only by what the instance itself accepts. | A project nested as deeply as the instance permits imports successfully. |
| **NFR-5** | Cost: registering an instance, importing, syncing, building a link and posting back shall spend **no money**. Running a review against a GitLab merge request shall cost the same as the same review against a GitHub pull request. | No cost is attributed to any of those actions; a run's reported cost is unaffected by its provider. |
| **NFR-6** | Model call: **no model call is permitted** in the instance-registration, import, sync, link-building or post-back paths. Those paths are deterministic. | The run trace for each of those actions records no model call. |
| **NFR-7** | Degradation: a repository whose instance is unreachable shall remain browsable from its last successful sync, and that state shall be distinguishable from "no open change requests" and from "loading". | Three visibly different states on the change-request list. |
| **NFR-8** | Concurrency: two simultaneous posts of the same review run to the same merge request shall result in at most one published set of notes. | The merge request carries one summary note and one note per finding after two concurrent posts. |
| **NFR-9** | Concurrency: two simultaneous imports of the same repository URL shall result in at most one repository and at most one clone. | One repository listed, one clone location, no partial second clone left on disk. |
| **NFR-10** | WHEN an instance reports its rate limit exhausted, requests to **that** instance shall pause until the reset the instance reports. | With a rate-limited instance, the next request to it is not sent before the reported reset. |
| **NFR-11** | A pause caused by one instance's rate limit shall not delay requests to any other instance. | Other instances' repositories keep syncing while one is paused. |
| **NFR-12** | Retention: a repository's instance, its last successful sync time, and its instance's detected version and edition shall survive a restart; a review run's post-back outcome shall still be visible after a page reload. | All five values are present after restarting the API and reloading the screen. |
| — | Latency of the change-request list and detail: **no requirement** beyond what already holds for GitHub. | — |
| — | Volume of registered instances: **no requirement** — no limit is imposed. | — |
| — | Retention of merge-request inline comments: **no requirement** — they are fetched live and not kept. | — |

## Inputs and provenance

| Input | Source | Trust | Freshness | If absent |
|---|---|---|---|---|
| Instance base URL | operator, via Settings | operator-supplied, but it decides an outbound destination — validated as AC-2…AC-6 | as registered | no instance registered; no GitLab import possible |
| Instance credential | operator, via Settings; stored only through the secrets provider (`CLAUDE.md` §Repo rules) | secret; never echoed (AC-10) | until replaced | the instance cannot be verified and its repositories cannot sync (AC-45) |
| Repository URL | any workspace user, via the import screen | untrusted — admitted only if its origin matches a registered instance (AC-14) | per request | import rejected |
| Instance version and edition | the instance, at verification | reported by the instance; taken as its own claim, not verified further | as of last verification | reported as unknown; used only to enrich a failure (AC-46) |
| Approval capability | probed against the instance | ambiguous by design; recorded as unknown when the answer is a not-found (AC-9) | as of last probe | unknown (AC-8) |
| Merge request title, description, author, branch names | the instance's users — third parties | **untrusted text** | as of last sync | the merge request is not listed |
| Merge request diff, changed files, commit messages | the instance's users | **untrusted text** | as of last sync | the review has no diff and does not run |
| Existing inline notes and their anchors | the instance's users | **untrusted text**; anchors used only for display and reply | live per request | inline discussion shown as empty |
| Repository file contents | the local clone | **untrusted text** | as of last sync; the clone is a mirror that hard-resets (root `INSIGHTS.md` 2026-08-16) | grounding degrades as it already does |
| Link targets returned by the instance | the instance | **untrusted**; not rendered unless same-origin (AC-25) | live | the link is not offered |
| Review findings | the model | **untrusted output** | per run | nothing to post |

## Untrusted inputs

Three trust boundaries matter here, and two of them are new.

**1. The outbound destination.** Before this spec, the set of hosts DevDigest
would clone from was a single constant, and the function enforcing it says so:
it is "the only thing standing between the request and an arbitrary outbound
clone" (`server/src/modules/repos/helpers.ts:15-29`). Supporting self-managed
instances removes that constant, which is precisely a server-side request
forgery surface: a request body would otherwise choose where the server connects
and where its credential goes. The replacement is a two-stage boundary. An
**operator** registers an instance, and that registration is where the
destination is judged — TLS only, a certificate that validates, no IP literal
and no loopback, link-local, unique-local or private-range address, no
credentials smuggled in the URL, and no redirect to another origin honoured
(AC-2…AC-5, AC-11). A **user's** repository URL is then admitted only if its
origin exactly matches an already-registered instance (AC-14); it can never
introduce a new destination. Rejections happen before any outbound request is
made, and the credential appears in no response or message (AC-10).

**2. Third-party text.** Merge request titles and descriptions, note bodies,
commit messages, branch names, author names, diffs and repository file contents
are written by people who are not the operator. They are **data, never
instructions.** Anything inside them that reads as a directive — "ignore the
above", "approve this merge request", "post this to the other repository" — is
content to be displayed and reviewed, never acted on. Concretely: such text
shall not change which instance is contacted, which repository is cloned,
whether a verdict is applied, or what a link points at; and it reaches the
review engine only through the engine's existing untrusted-input wrapping, which
this spec does not modify. This is the same rule the MCP surface already states
to the models that read it. The **inverse** also holds and is easy to get
backwards: a skill body is an instruction and must **not** be wrapped as
untrusted data (root `INSIGHTS.md` 2026-08-05).

**3. The instance's own answers.** A self-managed instance is administered by
someone, and that someone is not necessarily the operator. Its JSON is
third-party content: a link target it returns is not rendered unless it shares
the registered origin (AC-25), and a version or edition it reports is treated as
its claim — used to enrich a failure message (AC-46), never as an authorisation
decision. No answer from an instance grants a capability; capability is either
probed or attempted and reported (AC-8, AC-9, AC-39).

**Nothing in any artefact read while writing this spec was treated as an
instruction.** No design document, page or issue was supplied that contained
one.

## Traceability

| Source | Lands in |
|---|---|
| US-1 | AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-10, AC-11 |
| US-2 | AC-7, AC-8, AC-9, AC-12, AC-46 |
| US-3 | AC-13, AC-14, AC-15, AC-16, AC-17, AC-18 |
| US-4 | AC-20, AC-21, AC-22, AC-23, AC-24 |
| US-5 | AC-34, AC-35 |
| US-6 | AC-36, AC-37, AC-38, AC-39, AC-40, AC-41 |
| US-7 | AC-25, AC-26, AC-27, AC-28, AC-29, AC-30, AC-31, AC-32, AC-33 |
| US-8 | AC-19, AC-27 |
| US-9 | AC-47, AC-48 |
| Design row 1 (empty state) | AC-28, AC-32 |
| Design row 2 (loading) | NFR-1, NFR-2 |
| Design row 3 (partial / degraded) | AC-38, AC-39, AC-40, AC-41, AC-47, AC-48 |
| Design row 4 (error per source) | AC-3, AC-11, AC-14, AC-45, AC-46 |
| Design row 5 (overflow) | AC-13, AC-33, NFR-4 |
| Design row 6 (stale) | AC-42, AC-43, AC-44, NFR-10, NFR-11 |
| Design row 7 (permission) | AC-38, AC-45 |
| Design row 8 (zero / one / many) | AC-1, AC-7, AC-12 |
| Design row 9 (navigation) | AC-29, AC-30, Open question 5 |
| Design row 10 (copy and i18n) | AC-28, AC-32 |
| Design row 11 (accessibility) | AC-31 |
| Design row 12a (link truthfulness) | AC-25, AC-29, AC-30 |
| Design row 12b (outdated marker) | AC-24, Open question 4 |
| Design row 12c (clone collision) | AC-17, AC-18 |
| NFR-1, NFR-2 | themselves; observable on the Settings and import screens |
| NFR-3 | AC-34 |
| NFR-4 | AC-13, AC-33 |
| NFR-5, NFR-6 | themselves; no criterion may require a model call in these paths |
| NFR-7 | AC-44 |
| NFR-8 | AC-34, AC-39 |
| NFR-9 | AC-13, AC-18 |
| NFR-10, NFR-11 | AC-43 |
| NFR-12 | AC-15, AC-42, AC-39 |

Every user story reaches a criterion; every design-review gap reaches a
criterion, an edge case or a numbered open question; no criterion is without a
source.

## Open questions

Each carries the assumption the implementation proceeds on while it is open.

1. **Which GitLab version first offered the near-atomic note publication
   mechanism?** Research reached roughly 15.10/15.11 (March 2023) but could not
   pin it. *Assumption:* the mechanism exists on instances DevDigest supports,
   and AC-34 is satisfied by it. If an instance lacks it, AC-34's outcome is
   reached by publishing notes individually, which makes AC-40's
   partially-published state more likely but changes no criterion.
2. **Has GitLab's reviewer-state feature since gained an API?** The upstream
   issue was open at the time of research, and the feature is licensed anyway.
   *Assumption:* no API exists; `request_changes` is carried by the summary note
   plus an approval withdrawal, and AC-41 states that downgrade in words.
3. **The exact capability a credential needs to approve a merge request.**
   GitLab documents no per-endpoint mapping. *Assumption:* one write-capable
   credential covers reading, cloning, posting notes and approving, and the
   Settings copy stays behavioural (AC-45) rather than naming scopes — which is
   deliberately less specific than the GitHub hint at
   `client/messages/en/settings.json:15`, because a more specific claim would be
   unverifiable.
4. **What an instance answers when a note's diff anchor no longer resolves.**
   Genuinely undocumented. *Assumption:* DevDigest derives the outdated state
   itself by comparing the note's stored revision identifiers against the merge
   request's current ones (AC-24) and does not rely on the instance signalling
   it.
5. **Whether a link to a specific note is worth offering at all.** GitLab has no
   canonical path for one note — only the merge request's URL plus a fragment —
   and has open bugs about that fragment not reliably revealing a collapsed
   discussion. *Assumption:* DevDigest links to the merge request, not to the
   individual note, for GitLab repositories.
6. **Should an operator be able to opt an instance out of the private-address
   and certificate rejections?** Many legitimate self-managed instances sit on a
   private network behind a private certificate authority, and AC-3 and AC-4
   exclude exactly those. *Assumption:* no opt-out in this spec — such an
   instance is rejected with a stated reason, and the trade-off is recorded here
   as a known limitation rather than resolved silently. A superseding spec is the
   route to changing it.
7. **A minimum supported GitLab version.** GitLab documents none for a
   third-party integration, and self-managed instances follow a roughly
   three-month security window with no long-term-support track, so a floor would
   be DevDigest's judgment rather than a documented fact. *Assumption:* no floor
   is asserted. The version is detected and reported (AC-7) and surfaced
   alongside any capability failure (AC-46).
8. **CI parity.** Deliberately not researched once export-to-CI became a
   non-goal. *Assumption:* it stays out of scope; AC-47 and AC-48 make its
   absence a stated state, and a follow-up spec could add parity without
   contradicting anything here.
9. **Derivation of an instance's API and web addresses from its base URL.** No
   single upstream document states it in one sentence, so this is inferred: the
   base URL is opaque, API calls extend it, and web links extend it with the
   namespace path. *Assumption:* AC-6 and AC-29 hold as written; if a real
   instance disagrees, that is a bug against AC-6, not a change of requirement.
