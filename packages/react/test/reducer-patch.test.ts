import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentStream } from "../src/use-agent-stream.js";
import type { UIAppendEvent, UIReplaceEvent } from "@kibadist/agentui-protocol";

describe("useAgentStream + JSON Patch (via store)", () => {
  it("dispatch with patch event updates the corresponding node", () => {
    const { result } = renderHook(() =>
      useAgentStream({ url: "http://localhost/_unused", sessionId: "s", enabled: false }),
    );
    const append: UIAppendEvent = {
      v: 1, id: "a", ts: "t", sessionId: "s",
      op: "ui.append",
      node: { key: "n1", type: "Card", props: { tags: ["a", "b", "c"] } },
    };
    const patch: UIReplaceEvent = {
      v: 1, id: "r", ts: "t", sessionId: "s",
      op: "ui.replace", key: "n1",
      patch: [{ op: "replace", path: "/tags/1", value: "B" }],
    };
    act(() => {
      result.current.dispatch(append);
      result.current.dispatch(patch);
    });
    expect(result.current.state.nodes[0].props).toEqual({ tags: ["a", "B", "c"] });
  });

  it("dispatch with semantically-failing patch surfaces onInvalidEvent", () => {
    const onInvalidEvent = vi.fn();
    const { result } = renderHook(() =>
      useAgentStream({
        url: "http://localhost/_unused",
        sessionId: "s",
        enabled: false,
        onInvalidEvent,
      }),
    );
    act(() => {
      result.current.dispatch({
        v: 1, id: "a", ts: "t", sessionId: "s",
        op: "ui.append",
        node: { key: "n1", type: "Card", props: { a: 1 } },
      });
      result.current.dispatch({
        v: 1, id: "r", ts: "t", sessionId: "s",
        op: "ui.replace", key: "n1",
        patch: [{ op: "test", path: "/a", value: 999 }],
      });
    });
    expect(onInvalidEvent).toHaveBeenCalledTimes(1);
    expect(onInvalidEvent.mock.calls[0][1].message).toContain("patch apply failed");
  });
});
