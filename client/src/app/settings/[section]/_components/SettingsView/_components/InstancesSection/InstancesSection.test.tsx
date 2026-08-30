/**
 * Settings → Git Instances — SPEC-06
 * (`specs/2026-08-28-gitlab-repositories.md`) AC-1, AC-7, AC-8, AC-9, AC-10, AC-12.
 *
 * The three regressions this file exists to catch:
 * - a test result that leaks across rows (AC-12): with N instances registered,
 *   "the connection works" is a claim about ONE host, and attaching it to the
 *   wrong row is worse than showing nothing;
 * - a credential that comes back from the server and is re-rendered (AC-10);
 * - an *unknown* approval capability rendered as "unavailable" (AC-8, AC-9).
 *   Those are different claims: GitLab answers the same 404 for "not licensed"
 *   and "not permitted", so "unavailable" is a guess about something the
 *   instance deliberately does not disclose (root `INSIGHTS.md` 2026-08-28).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { GitInstance, InstanceTestResult } from "@devdigest/shared";
// Eight `../` from …/SettingsView/_components/InstancesSection/.
import messages from "../../../../../../../../messages/en/settings.json";

let instancesState: { data: GitInstance[] | undefined; isLoading: boolean; isError: boolean } = {
  data: [],
  isLoading: false,
  isError: false,
};

/** What the fake `POST /instances/:id/test` answers, per instance id. */
let testResults: Record<string, InstanceTestResult> = {};
const registerMutate = vi.fn();
const deleteMutate = vi.fn();

vi.mock("@/lib/hooks/instances", () => ({
  useInstances: () => instancesState,
  useRegisterInstance: () => ({ mutateAsync: registerMutate, isPending: false }),
  useTestInstance: () => ({
    mutate: (id: string, opts?: { onSuccess?: (r: InstanceTestResult) => void }) =>
      opts?.onSuccess?.(testResults[id]!),
    isPending: false,
    variables: undefined,
  }),
  useDeleteInstance: () => ({ mutate: deleteMutate, isPending: false, variables: undefined }),
}));

import { InstancesSection } from "./InstancesSection";

function instance(over: Partial<GitInstance> = {}): GitInstance {
  return {
    id: "i1",
    workspace_id: "w1",
    provider: "gitlab",
    base_url: "https://gitlab.acme.dev",
    label: "Acme GitLab",
    version: null,
    edition: null,
    approval_capability: "unknown",
    verified_at: null,
    created_at: "2026-08-28T10:00:00.000Z",
    ...over,
  };
}

/**
 * A successful test result for one instance.
 *
 * `instance_id` is the whole point: the screen attributes an outcome by id, so a
 * fixture that returned a fixed id would make the AC-12 assertions vacuous.
 */
function ok(id: string): InstanceTestResult {
  return {
    instance_id: id,
    ok: true,
    code: null,
    message: "reachable",
    version: "17.4.1",
    edition: "ee",
    approval_capability: "unknown",
  };
}

function renderSection() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ settings: messages }}>
      <InstancesSection />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  instancesState = { data: [], isLoading: false, isError: false };
  testResults = {};
  registerMutate.mockReset();
  deleteMutate.mockReset();
});

describe("InstancesSection — zero, one, many (AC-1)", () => {
  it("states that nothing is registered yet", () => {
    renderSection();
    expect(screen.getByText("No instances registered")).toBeInTheDocument();
  });

  it("counts one instance in the singular", () => {
    instancesState = { data: [instance()], isLoading: false, isError: false };
    renderSection();
    expect(screen.getByText("1 registered instance")).toBeInTheDocument();
  });

  it("counts many, and lists every one of them", () => {
    instancesState = {
      data: [instance(), instance({ id: "i2", label: "Team GitLab" })],
      isLoading: false,
      isError: false,
    };
    renderSection();
    expect(screen.getByText("2 registered instances")).toBeInTheDocument();
    expect(screen.getByText("Acme GitLab")).toBeInTheDocument();
    expect(screen.getByText("Team GitLab")).toBeInTheDocument();
  });
});

describe("InstancesSection — per-instance test result (AC-12)", () => {
  it("attributes the result to the row that was tested and leaves the other alone", async () => {
    const user = userEvent.setup();
    instancesState = {
      data: [instance(), instance({ id: "i2", label: "Team GitLab" })],
      isLoading: false,
      isError: false,
    };
    testResults = { i1: ok("i1"), i2: ok("i2") };
    renderSection();

    // No result anywhere before anything is tested.
    expect(screen.queryAllByRole("status")).toHaveLength(0);

    await user.click(screen.getAllByRole("button", { name: "Test" })[0]!);

    const results = screen.getAllByRole("status");
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveTextContent("Acme GitLab: reachable.");
    expect(screen.queryByText(/Team GitLab: /)).toBeNull();
  });

  it("keeps the first row's result when the second is tested", async () => {
    const user = userEvent.setup();
    instancesState = {
      data: [instance(), instance({ id: "i2", label: "Team GitLab" })],
      isLoading: false,
      isError: false,
    };
    testResults = {
      i1: ok("i1"),
      i2: { ...ok("i2"), ok: false, code: "unreachable", message: "no route to host" },
    };
    renderSection();

    await user.click(screen.getAllByRole("button", { name: "Test" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Test" })[1]!);

    const results = screen.getAllByRole("status");
    expect(results).toHaveLength(2);
    // Each row states its OWN outcome — one reachable, one not.
    expect(results[0]).toHaveTextContent("Acme GitLab: reachable.");
    expect(results[1]).toHaveTextContent("Team GitLab: no route to host");
  });
});

describe("InstancesSection — version and edition (AC-7)", () => {
  it("shows the detected version and edition once they are known", () => {
    instancesState = {
      data: [instance({ version: "17.4.1", edition: "ee", verified_at: "2026-08-28T11:00:00Z" })],
      isLoading: false,
      isError: false,
    };
    renderSection();

    expect(screen.getByText("Version 17.4.1")).toBeInTheDocument();
    expect(screen.getByText("Edition ee")).toBeInTheDocument();
  });

  it("says the version is not detected yet rather than inventing one", () => {
    instancesState = { data: [instance()], isLoading: false, isError: false };
    renderSection();

    expect(screen.getByText("Version not detected yet")).toBeInTheDocument();
    expect(screen.getByText("Not verified yet")).toBeInTheDocument();
  });
});

describe("InstancesSection — approval capability (AC-8, AC-9)", () => {
  it("renders an unknown capability as explicitly unknown, never as unavailable", () => {
    instancesState = {
      data: [instance({ approval_capability: "unknown" })],
      isLoading: false,
      isError: false,
    };
    renderSection();

    expect(
      screen.getByText(/Approval support is unknown/, { exact: false }),
    ).toBeInTheDocument();
    // The distinction the whole three-state design exists for: "we do not know"
    // must not be worded as "this instance cannot do it".
    expect(screen.queryByText(/unavailable|not supported|cannot approve/i)).toBeNull();
  });

  it("renders a refused capability as its own, different sentence", () => {
    instancesState = {
      data: [instance({ approval_capability: "refused" })],
      isLoading: false,
      isError: false,
    };
    renderSection();

    expect(screen.getByText(/Approvals are refused for this token/)).toBeInTheDocument();
    expect(screen.queryByText(/Approval support is unknown/)).toBeNull();
  });

  it("renders a permitted capability as permitted", () => {
    instancesState = {
      data: [instance({ approval_capability: "permitted" })],
      isLoading: false,
      isError: false,
    };
    renderSection();

    expect(screen.getByText(/Approvals can be recorded/)).toBeInTheDocument();
  });
});

describe("InstancesSection — the credential is write-only (AC-10)", () => {
  const TOKEN = "glpat-NEVER-SHOW-ME-AGAIN";

  it("is a masked field, cleared after a successful register and never re-rendered", async () => {
    const user = userEvent.setup();
    // The response carries no credential — that is the contract. If the form
    // repopulated the field, it could only be from something it kept itself.
    registerMutate.mockResolvedValue(instance({ id: "i9", label: "Acme GitLab" }));
    renderSection();

    const credential = screen.getByLabelText("Access token");
    expect(credential).toHaveAttribute("type", "password");

    await user.type(screen.getByLabelText("Base URL"), "https://gitlab.acme.dev");
    await user.type(screen.getByLabelText("Label"), "Acme GitLab");
    await user.type(credential, TOKEN);
    await user.click(screen.getByRole("button", { name: "Register instance" }));

    await waitFor(() => expect(credential).toHaveValue(""));
    // …and nowhere on the screen, not in a row, a hint or a result message.
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(
      within(document.body).queryAllByDisplayValue(TOKEN),
    ).toHaveLength(0);
  });

  it("keeps the token out of the failure message when registration is refused", async () => {
    const user = userEvent.setup();
    registerMutate.mockRejectedValue(new Error("boom"));
    renderSection();

    await user.type(screen.getByLabelText("Base URL"), "https://gitlab.acme.dev");
    await user.type(screen.getByLabelText("Label"), "Acme GitLab");
    await user.type(screen.getByLabelText("Access token"), TOKEN);
    await user.click(screen.getByRole("button", { name: "Register instance" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not register this instance");
    expect(alert.textContent).not.toContain(TOKEN);
  });

  it("cannot be submitted without all three fields", async () => {
    const user = userEvent.setup();
    renderSection();

    expect(screen.getByRole("button", { name: "Register instance" })).toBeDisabled();
    await user.type(screen.getByLabelText("Base URL"), "https://gitlab.acme.dev");
    await user.type(screen.getByLabelText("Label"), "Acme GitLab");
    // Still disabled: a credential-less registration would look registered and
    // fail on the first sync.
    expect(screen.getByRole("button", { name: "Register instance" })).toBeDisabled();
  });
});
