import { Module } from "@nestjs/common";
import { AgentModule } from "./agent/agent.module.js";

@Module({
  imports: [AgentModule],
})
export class AppModule {}
