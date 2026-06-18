import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = process.env.PORT ?? 3003;
  await app.listen(port);
  console.log(`[agentui] svg-api listening on http://localhost:${port}`);
}
bootstrap();
