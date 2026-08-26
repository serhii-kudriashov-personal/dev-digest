import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/conventions.json";
import { ConventionCard } from "./ConventionCard";
import { confidenceColor, evidenceRef, githubBlobUrl } from "./helpers";

afterEach(cleanup);

const CANDIDATE: ConventionCandidate = {
  id: "cv1",
  rule: "Always use async/await instead of .then() chains.",
  category: "structure",
  evidence_path: "src/api/users.ts",
  evidence_snippet: "const user = await db.users.find(id);",
  evidence_line_start: 23,
  evidence_line_end: 31,
  confidence: 0.91,
  status: "pending",
  created_at: "2026-08-05T10:00:00.000Z",
};

function renderCard(over: Partial<ConventionCandidate> = {}, props: Partial<Parameters<typeof ConventionCard>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionCard
        c={{ ...CANDIDATE, ...over }}
        onAccept={props.onAccept ?? vi.fn()}
        onReject={props.onReject ?? vi.fn()}
        onSaveRule={props.onSaveRule ?? vi.fn().mockResolvedValue(undefined)}
        {...("evidenceHref" in props ? { evidenceHref: props.evidenceHref } : {})}
      />
    </NextIntlClientProvider>,
  );
}

describe("ConventionCard", () => {
  it("renders the rule, the category and the snippet", () => {
    renderCard();
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(screen.getByText("structure")).toBeInTheDocument();
    expect(screen.getByText("const user = await db.users.find(id);")).toBeInTheDocument();
  });

  it("cites the evidence as path:start-end", () => {
    renderCard();
    expect(screen.getByText("src/api/users.ts:23-31")).toBeInTheDocument();
  });

  it("links the evidence to GitHub, opening in a new tab", () => {
    const href = "https://github.com/acme/payments-api/blob/main/src/api/users.ts#L23-L31";
    renderCard({}, { evidenceHref: href });
    const link = screen.getByRole("link", { name: "src/api/users.ts:23-31" });
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("target", "_blank");
    // rel is not optional on a target=_blank link to a third-party host.
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("renders the reference as plain text when there is no URL — never a dead link", () => {
    renderCard({}, { evidenceHref: null });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:23-31")).toBeInTheDocument();
  });

  it("renders the confidence as a percentage", () => {
    renderCard();
    expect(screen.getByText("91%")).toBeInTheDocument();
  });

  it("stays visible when rejected — a hidden rejection cannot be undone", () => {
    renderCard({ status: "rejected" });
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    // The Accept button is still live, which is how the rejection is taken back.
    expect(screen.getByRole("button", { name: /Accept/ })).toBeEnabled();
  });

  it("labels the buttons by state", () => {
    renderCard({ status: "accepted" });
    expect(screen.getByRole("button", { name: /Accepted/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Reject$/ })).toBeInTheDocument();
  });

  it("reports accept and reject to the parent", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    renderCard({}, { onAccept, onReject });
    fireEvent.click(screen.getByRole("button", { name: /Accept/ }));
    expect(onAccept).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Reject/ }));
    expect(onReject).toHaveBeenCalled();
  });

  it("edits only the rule — the evidence is never editable", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Edit rule/ }));
    const box = screen.getByRole("textbox");
    expect(box).toHaveValue(CANDIDATE.rule);
    // One editable field, and it is the rule. The snippet stays a <pre>.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("saves an edited rule and leaves edit mode", async () => {
    const onSaveRule = vi.fn().mockResolvedValue(undefined);
    renderCard({}, { onSaveRule });
    fireEvent.click(screen.getByRole("button", { name: /Edit rule/ }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Prefer async/await over promise chains." },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() =>
      expect(onSaveRule).toHaveBeenCalledWith("Prefer async/await over promise chains."),
    );
    // The saving state settles and the field closes — awaited so the state update
    // that follows the mutation is not left dangling outside act().
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
  });

  it("does not call the server when the rule was not actually changed", () => {
    const onSaveRule = vi.fn().mockResolvedValue(undefined);
    renderCard({}, { onSaveRule });
    fireEvent.click(screen.getByRole("button", { name: /Edit rule/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(onSaveRule).not.toHaveBeenCalled();
  });

  it("discards the draft on cancel", () => {
    const onSaveRule = vi.fn();
    renderCard({}, { onSaveRule });
    fireEvent.click(screen.getByRole("button", { name: /Edit rule/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "throwaway" } });
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(onSaveRule).not.toHaveBeenCalled();
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
  });
});

describe("evidenceRef", () => {
  it("collapses a single-line span", () => {
    expect(evidenceRef({ ...CANDIDATE, evidence_line_start: 9, evidence_line_end: 9 })).toBe(
      "src/api/users.ts:9",
    );
  });

  it("omits the range when there is none", () => {
    expect(evidenceRef({ ...CANDIDATE, evidence_line_start: 0, evidence_line_end: 0 })).toBe(
      "src/api/users.ts",
    );
  });
});

describe("githubBlobUrl", () => {
  const REPO = { full_name: "acme/payments-api", default_branch: "main" };

  it("builds a blob URL with the line range as an anchor", () => {
    expect(githubBlobUrl(CANDIDATE, REPO)).toBe(
      "https://github.com/acme/payments-api/blob/main/src/api/users.ts#L23-L31",
    );
  });

  it("collapses a single-line anchor", () => {
    expect(
      githubBlobUrl({ ...CANDIDATE, evidence_line_start: 9, evidence_line_end: 9 }, REPO),
    ).toBe("https://github.com/acme/payments-api/blob/main/src/api/users.ts#L9");
  });

  it("links the file with no anchor rather than `#L0` when no range was computed", () => {
    expect(
      githubBlobUrl({ ...CANDIDATE, evidence_line_start: 0, evidence_line_end: 0 }, REPO),
    ).toBe("https://github.com/acme/payments-api/blob/main/src/api/users.ts");
  });

  it("uses the repo's own default branch, not a hardcoded main", () => {
    expect(githubBlobUrl(CANDIDATE, { ...REPO, default_branch: "trunk" })).toContain(
      "/blob/trunk/",
    );
  });

  it("returns null while the repo is still loading, so no dead link renders", () => {
    expect(githubBlobUrl(CANDIDATE, undefined)).toBeNull();
  });

  it("returns null when the candidate has no evidence path", () => {
    expect(githubBlobUrl({ ...CANDIDATE, evidence_path: "" }, REPO)).toBeNull();
  });
});

describe("confidenceColor", () => {
  it("is the ONLY thing confidence drives — colour, never ranking", () => {
    expect(confidenceColor(0.91)).toBe("var(--ok)");
    expect(confidenceColor(0.78)).toBe("var(--warn)");
    expect(confidenceColor(0.2)).toBe("var(--crit)");
  });
});
