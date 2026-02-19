import { map } from "rxjs";
import type { Observable } from "rxjs";
import type { UIEvent, ActionEvent } from "@agentui/protocol";
import { parseActionEvent } from "@agentui/validate";
import type { AgentSessionService } from "./session.service.js";

/**
 * A NestJS-compatible MessageEvent shape used by @Sse() handlers.
 */
export interface SseMessageEvent {
  data: string;
  id?: string;
  type?: string;
}

export interface AgentControllerOptions {
  sessionService: AgentSessionService;
  /**
   * Called when a new session is created.
   * Use this to kick off your agent loop.
   */
  onSessionCreated?: (sessionId: string) => void | Promise<void>;
  /**
   * Called when an action is received.
   * Use this to feed actions into your agent loop.
   */
  onAction?: (sessionId: string, action: ActionEvent) => void | Promise<void>;
}

/**
 * Factory that returns handler functions you can wire into a NestJS controller.
 *
 * Usage in a @Controller('agent'):
 *   const handlers = createAgentController({ sessionService, onAction, ... });
 *
 *   @Post('session')
 *   createSession() { return handlers.createSession(); }
 *
 *   @Sse(':sessionId/stream')
 *   stream(@Param('sessionId') id: string) { return handlers.stream(id); }
 *
 *   @Post(':sessionId/action')
 *   action(@Param('sessionId') id: string, @Body() body: unknown) {
 *     return handlers.action(id, body);
 *   }
 */
export function createAgentController(opts: AgentControllerOptions) {
  const { sessionService, onSessionCreated, onAction } = opts;

  return {
    async createSession(): Promise<{ sessionId: string }> {
      const sessionId = crypto.randomUUID();
      sessionService.create(sessionId);
      await onSessionCreated?.(sessionId);
      return { sessionId };
    },

    stream(sessionId: string): Observable<SseMessageEvent> {
      return sessionService.uiStream(sessionId).pipe(
        map((event: UIEvent) => ({
          data: JSON.stringify(event),
          id: event.id,
        })),
      );
    },

    async action(sessionId: string, body: unknown): Promise<{ ok: true }> {
      const action = parseActionEvent(body);
      sessionService.emitAction(sessionId, action);
      await onAction?.(sessionId, action);
      return { ok: true };
    },
  };
}
