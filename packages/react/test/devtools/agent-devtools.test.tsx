import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { AgentDevTools } from "../../src/devtools/agent-devtools.js";
import { AgentStateProvider } from "../../src/agent-state-context.js";
import { createAgentStore } from "../../src/store.js";
import type { ReactNode } from "react";
import type { AgentAction } from "../../src/reducer.js";

const append = (key: string): AgentAction => ({
  op: "ui.append",
  id: `e-${key}`,
  ts: new Date().toISOString(),
  sessionId: "s-1",
  node: { key, type: "text-block", props: { text: "x" } },
});

function Wrap({ children, store }: { children: ReactNode; store: ReturnType<typeof createAgentStore> }) {
  return <AgentStateProvider store={store}>{children}</AgentStateProvider>;
}

describe("<AgentDevTools />", () => {
  beforeEach(() => {
    // Default NODE_ENV in vitest is "test" — devtools enabled by default.
  });
  afterEach(() => {
    cleanup();
  });

  it("renders chrome when enabled", () => {
    const store = createAgentStore();
    render(
      <Wrap store={store}>
        <AgentDevTools enabled />
      </Wrap>,
    );
    expect(screen.getByText(/AgentDevTools/i)).toBeTruthy();
    expect(screen.getByRole("slider")).toBeTruthy();
  });

  it("renders null and does NOT subscribe when enabled=false", () => {
    const store = createAgentStore();
    const spy = vi.spyOn(store, "subscribeAction");
    const { container } = render(
      <Wrap store={store}>
        <AgentDevTools enabled={false} />
      </Wrap>,
    );
    expect(container.firstChild).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("scrubber moves as events accumulate (stays at live until grabbed)", async () => {
    const store = createAgentStore();
    render(
      <Wrap store={store}>
        <AgentDevTools enabled />
      </Wrap>,
    );

    act(() => {
      store.send(append("k1"));
      store.send(append("k2"));
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });

    const slider = screen.getByRole("slider") as HTMLInputElement;
    // At live: value should match events.length (2).
    expect(slider.max).toBe("2");
    expect(slider.value).toBe("2");
  });

  it("collapse button toggles body", () => {
    const store = createAgentStore();
    render(
      <Wrap store={store}>
        <AgentDevTools enabled />
      </Wrap>,
    );
    const collapse = screen.getByRole("button", { name: /collapse|expand/i });
    fireEvent.click(collapse);
    // After collapse, slider should be hidden.
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("throws when mounted outside AgentRoot/AgentStateProvider", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<AgentDevTools enabled />)).toThrow(/agentui/i);
    consoleErrorSpy.mockRestore();
  });
});
