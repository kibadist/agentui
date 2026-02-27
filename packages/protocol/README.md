# @kibadist/agentui-protocol

Core TypeScript types for the AgentUI wire protocol.

## Install

```bash
npm install @kibadist/agentui-protocol
```

## Overview

This package defines the event contract for bidirectional communication between an AI agent and a React UI. All events flow as typed, versioned messages with session correlation.

**UI Events** (agent to frontend) describe how to patch the rendered UI:

| Operation | Description |
|---|---|
| `ui.append` | Add a component to the render list |
| `ui.replace` | Update an existing component's props |
| `ui.remove` | Remove a component by key |
| `ui.toast` | Show an ephemeral notification |
| `ui.navigate` | Trigger client-side navigation |

**Action Events** (frontend to agent) capture user interactions:

| Type | Description |
|---|---|
| `action.submit` | Form submission or message send |
| `action.select` | Item selection |
| `action.approve` | Explicit user approval |
| `action.generic` | Custom action |

## Usage

```ts
import type {
  UIEvent,
  ActionEvent,
  UINode,
  UIAppendEvent,
  UIReplaceEvent,
} from "@kibadist/agentui-protocol";

// A UI node the agent wants to render
const node: UINode = {
  key: "card-1",
  type: "info-card",
  props: { title: "Hello", body: "World" },
};

// An append event
const event: UIAppendEvent = {
  v: 1,
  id: "evt-1",
  ts: new Date().toISOString(),
  sessionId: "session-123",
  kind: "ui",
  op: "ui.append",
  node,
};
```

## Exports

| Export | Kind | Description |
|---|---|---|
| `UIEvent` | type | Union of all UI patch operations |
| `ActionEvent` | type | Union of all user action types |
| `AgentUIEvent` | type | `UIEvent \| ActionEvent` |
| `UINode` | interface | Renderable component: key, type, props, optional slot/children/meta |
| `BaseEvent` | interface | Common fields: v, id, ts, sessionId, traceId? |
| `UIAppendEvent` | interface | Append operation |
| `UIReplaceEvent` | interface | Replace operation |
| `UIRemoveEvent` | interface | Remove operation |
| `UIToastEvent` | interface | Toast notification |
| `UINavigateEvent` | interface | Client-side navigation |
| `ActionSubmitEvent` | interface | Submit action |
| `ActionSelectEvent` | interface | Select action |
| `ActionApproveEvent` | interface | Approve action |
| `ActionGenericEvent` | interface | Generic action |

## License

MIT
