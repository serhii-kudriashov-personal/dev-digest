# Spec: PR Risk Brief — Overview tab layout revision

Spec ID: SPEC-03
Created: 2026-08-17
Status: draft
Supersedes: specs/2026-08-16-pr-why-risk-brief.md (SPEC-02) — layout only;
every other decision in SPEC-02 stands unchanged and is not repeated here.

## Problem and user

SPEC-02 shipped (`d47b0a2`, "brief 1zt iteration") with the brief's
what-and-why statement, risk level, risks, review-focus list, regenerate
control and cost all inside one new card — `BriefCard` — sitting below the
existing Intent and Blast Radius cards on the pull request's Overview tab.

The feature owner has since reviewed a second design reference (two
screenshots of a different product's PR-review screen) and wants the same
information laid out differently: the Intent and Blast Radius cards stay side
by side as they already are; the risks the brief identified render inside the
Intent card, next to the intent that motivated the change; the brief's own
status and controls sit in a slim row above that pair; and the "read this
first" review-focus list becomes its own section beneath the row, right
before the pull request's description. Nothing about what the brief computes,
validates or is allowed to say changes — only where a reviewer's eye lands
first, and which existing card the risks sit beside.

## Goals / Non-goals

**Goals**

- The three groups of fields SPEC-02 already defined render in three places
  instead of one card, with no new field, cap, validation rule, or generation
  state introduced.
- The Intent card gains exactly one new responsibility: rendering a risks
  list it does not compute, fetch, or validate — the same relationship it
  already has with its own intent text, which L03 derives and the card only
  renders.
- Every acceptance criterion in SPEC-02 (AC-1…AC-45) still holds after this
  change, observed on a different component than the one named when it was
  written.

**Non-goals**

- Any change to `BriefAnswer`, `StoredRiskBrief`, `PrRiskBriefRecord`,
  `BriefGenerationResult`, or any server-side behaviour in
  `server/src/modules/brief/**`. This spec touches no ring 0–3 code.
- Any change to `useDiffLineTarget`'s focus-after-navigation behaviour,
  already shipped under SPEC-02's AC-32, or to L04/L06 more broadly.
- Re-opening any SPEC-02 decision other than placement: the six inputs, the
  8 000-token budget and drop order, the validation and redaction rules, the
  three-level risk enum, the five-item caps, and every failure/degradation
  state all stand exactly as SPEC-02 wrote them.

## User stories

- **US-1** — As a reviewer, I want the risks the brief found next to the
  intent that motivated the change, so I read "what and why" together with
  "what could go wrong" in one glance, instead of a separate card competing
  for the same vertical space as Blast Radius.
- **US-2** — As a reviewer, I want the brief's own status — fresh, stale,
  cost, regenerate — visible before I read either card, so I know whether
  what I am about to read is current.
- **US-3** — As a reviewer, I want "read this first" as its own section
  directly below the two summary cards, so it reads as the bridge into the
  diff rather than being buried inside a status card I may skim past.

## Acceptance criteria (EARS)

**AC-46** — The system shall render the what-and-why statement, the risk
level, the regenerate control, the cost, the included/missing-input labels,
the dropped-reference count, the stale marker and the model-generated label
in one row positioned above the Intent and Blast Radius cards.
  *Verification:* on the Overview tab, all eight elements are found in one
  region of the page preceding both cards.

**AC-47** — The system shall render the brief's risks list inside the Intent
card, positioned beneath its in-scope and out-of-scope bullets, applying the
same zero/one/many rules SPEC-02 AC-42 and AC-43 already state.
  *Verification:* a brief carrying three risks shows all three inside the
  Intent card; a brief carrying zero risks shows AC-43's sentence there,
  never in a separate risks card.

**AC-48** — The system shall render the review-focus list as a section
positioned after the Intent-and-Blast-Radius row and before the pull
request's description, applying the same navigation, caps and empty-state
rules SPEC-02 AC-21 and AC-30–AC-33 already state.
  *Verification:* activating an entry in that section navigates exactly as
  SPEC-02's AC-30 specifies; a brief with zero focus entries renders AC-21's
  sentence in that position, never inside the header row or the Intent card.

**AC-49** — The system shall present all three surfaces from one fetch of the
brief; no surface shall issue its own request or hold its own copy of the
brief's state.
  *Verification:* one Overview tab load issues exactly one request for the
  brief, and it feeds all three surfaces.

**AC-50** — WHILE the brief has never been generated for the pull request,
the header row shall present SPEC-02's AC-26 empty state, and the Intent card
and the review-focus section shall present neither risks nor review-focus
content nor an error.
  *Verification:* a never-briefed pull request shows the generate action only
  in the header row; the Intent card and the space the review-focus section
  would occupy show nothing extra.

## Edge cases

| Case | Decided behaviour | Owner |
|---|---|---|
| Brief never generated | header shows the empty state; Intent card and review-focus area show nothing extra, no error | AC-50 |
| Brief has zero risks | the Intent card's risk sub-section states so explicitly (SPEC-02 AC-43), never omitted | AC-47 |
| Brief has zero review-focus entries | the standalone section states so explicitly (SPEC-02 AC-21), never a blank gap | AC-48 |
| Brief is stale | the stale marker and regenerate control live only in the header row; the Intent card's risks and the review-focus list still show the last-generated content — SPEC-02's "stale is a readable warning, never a blank card" still holds | AC-46, AC-47, AC-48 |

## Design & UX review

Reference: the feature owner supplied two further screenshots on 2026-08-17
(an informal reference product's PR-review screen, not this repo's own UI),
in addition to the mocks SPEC-02 already reviewed. SPEC-02's twelve-check
table is the design review of the original mocks and is not repeated here;
this section covers only what the second reference adds.

Everything visible in the new reference maps onto a field SPEC-02 already
specified — the reference draws no new capability, only a different
arrangement of the same fields. The one placement it settles that SPEC-02
left as a single card: **risks beside intent, status above both cards, review
focus below them.** SPEC-02's own reasoning for the original placement — "one
card has one owner" — is superseded for placement only; the ownership
boundary it protected is unchanged, since the Intent card still computes,
fetches and validates none of the risk data it renders.

## Workflows and contracts

No new participant, hop, or contract field. SPEC-02's sequence diagram and
its `## Contract promises` table hold exactly as written; this spec only
re-addresses *where on the page* those fields land:

| Field (from SPEC-02 §Contract promises) | Renders in |
|---|---|
| what, why, risk level, regenerate, cost, generated-at/provider/model, included/missing inputs, dropped references, stale | the header row (AC-46) |
| risks | the Intent card (AC-47) |
| review focus | the standalone review-focus section (AC-48) |

## Non-functional requirements

Unchanged from SPEC-02 NFR-1…NFR-8. This spec moves markup, not data: no new
latency, volume, or cost implication follows from it.

## Inputs and provenance

Unchanged from SPEC-02 §Inputs and provenance. This spec introduces no new
input and reads the same `PrRiskBriefRecord` SPEC-02 already defines and the
already-shipped `usePrBrief`/`useGenerateBrief` hooks already fetch.

## Untrusted inputs

Unchanged from SPEC-02 §Untrusted inputs. Every trust boundary, validation
and redaction step already runs before any of this spec's three surfaces see
the data — nothing here reads the model's answer, the PR text, or any other
untrusted source directly.

## Traceability

| Source | Lands in |
|---|---|
| US-1 | AC-47 |
| US-2 | AC-46 |
| US-3 | AC-48 |
| SPEC-02 AC-25, AC-28, AC-34, AC-35, AC-37, AC-40, AC-41 | AC-46 (same criteria, new location) |
| SPEC-02 AC-42, AC-43 | AC-47 |
| SPEC-02 AC-21, AC-30–AC-33, AC-42, AC-44 | AC-48 |
| SPEC-02 AC-26 | AC-50 |
| Design review, second reference (2026-08-17) | AC-46, AC-47, AC-48 |

## Open questions

1. **Whether `IntentCard` gaining a risks-rendering responsibility earns a
   later promotion** (e.g. a standalone `RiskList` component reusable
   elsewhere). *Assumption to proceed on:* no — `IntentCard` is its only
   consumer today, so `frontend-ui-architecture`'s promotion rule keeps the
   rendering inline; revisit only if a second consumer appears.
