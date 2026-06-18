import { Controller, Post, Param, Body, Sse, Inject, Logger } from "@nestjs/common";
import type { Observable } from "rxjs";
import { createAgentController, type SseMessageEvent } from "@kibadist/agentui-nest";
import { AgentService } from "./agent.service.js";

@Controller("agent")
export class AgentController {
  private readonly logger = new Logger(AgentController.name);
  private readonly handlers;

  constructor(@Inject(AgentService) private readonly agentService: AgentService) {
    this.handlers = createAgentController({
      sessionService: agentService.sessionService,
      onSessionCreated: (id) => agentService.handleSessionCreated(id),
      onAction: (id, action) => agentService.handleAction(id, action),
    });
  }

  @Post("session")
  async createSession(): Promise<{ sessionId: string }> {
    const result = await this.handlers.createSession();
    this.logger.log(`Session created: ${result.sessionId}`);
    return result;
  }

  @Sse(":sessionId/stream")
  stream(
    @Param("sessionId") sessionId: string,
  ): Observable<SseMessageEvent> {
    this.logger.log(`SSE stream opened: ${sessionId}`);
    return this.handlers.stream(sessionId);
  }

  @Post(":sessionId/action")
  async action(
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    return this.handlers.action(sessionId, body);
  }
}
