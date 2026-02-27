# @kibadist/agentui-nest

NestJS session management and controller factory for the AgentUI protocol.

## Install

```bash
npm install @kibadist/agentui-nest
```

**Peer dependencies:** `@nestjs/common` ^10.0.0 || ^11.0.0, `rxjs` ^7.0.0

## Quick start

### 1. Create a service

```ts
import { Injectable } from "@nestjs/common";
import { AgentSessionService } from "@kibadist/agentui-nest";

@Injectable()
export class AgentService {
  readonly sessionService = new AgentSessionService();

  constructor() {
    this.sessionService.startCleanup(); // auto-expire sessions after 30min
  }

  async handleAction(sessionId: string, action: ActionEvent) {
    // Process the user action and emit UI events back
    this.sessionService.emitUI(sessionId, {
      v: 1,
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      sessionId,
      kind: "ui",
      op: "ui.append",
      node: { key: "msg-1", type: "text-block", props: { body: "Hello!" } },
    });
  }
}
```

### 2. Create a controller

```ts
import { Controller, Post, Param, Body, Sse } from "@nestjs/common";
import { createAgentController } from "@kibadist/agentui-nest";
import { AgentService } from "./agent.service";

@Controller("agent")
export class AgentController {
  private handlers;

  constructor(private agentService: AgentService) {
    this.handlers = createAgentController({
      sessionService: agentService.sessionService,
      onAction: (id, action) => agentService.handleAction(id, action),
    });
  }

  @Post("session")
  createSession() {
    return this.handlers.createSession();
  }

  @Sse(":sessionId/stream")
  stream(@Param("sessionId") id: string) {
    return this.handlers.stream(id);
  }

  @Post(":sessionId/action")
  action(@Param("sessionId") id: string, @Body() body: unknown) {
    return this.handlers.action(id, body);
  }
}
```

This gives you three endpoints:
- `POST /agent/session` - creates a session, returns `{ sessionId }`
- `GET /agent/:sessionId/stream` - SSE stream of UIEvents
- `POST /agent/:sessionId/action` - accepts ActionEvents from the frontend

## AgentSessionService API

| Method | Description |
|---|---|
| `create(sessionId?)` | Create a session (auto-generates ID if omitted) |
| `get(sessionId)` | Retrieve a session entry |
| `emitUI(sessionId, event)` | Push a UIEvent to the session's SSE stream |
| `emitAction(sessionId, action)` | Push an ActionEvent for agent consumption |
| `uiStream(sessionId)` | Get Observable of UIEvents |
| `actionStream(sessionId)` | Get Observable of ActionEvents |
| `destroy(sessionId)` | Clean up a session |
| `startCleanup(intervalMs?)` | Start periodic cleanup of expired sessions (default 30min TTL) |
| `stopCleanup()` | Stop the cleanup timer |

## Exports

| Export | Kind | Description |
|---|---|---|
| `AgentSessionService` | class | In-memory session manager with RxJS observables |
| `createAgentController` | function | Factory returning handler functions for NestJS controllers |
| `SseMessageEvent` | interface | Shape for `@Sse()` decorator responses |
| `AgentControllerOptions` | interface | Options for `createAgentController` |
| `SessionEntry` | interface | Session data: `ui$`, `action$` Subjects, `createdAt` |

## License

MIT
