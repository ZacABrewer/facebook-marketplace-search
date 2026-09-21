import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { authEnabled, config, hasClaudeCredentials } from "./config.js";
import { registerAuth } from "./auth.js";
import { getDb } from "./db.js";
import { apiRoutes } from "./routes/api.js";
import { startScheduler, stopScheduler } from "./watches.js";
import { closeBrowser } from "./sources/facebook.js";

async function main(): Promise<void> {
  getDb();
  const app = Fastify({ logger: { level: "info" } });
  await app.register(cors, { origin: true });
  registerAuth(app);
  await app.register(apiRoutes);

  if (fs.existsSync(path.join(config.webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  } else {
    app.log.warn(`web/dist not found at ${config.webDist}; run "npm run build" or use the Vite dev server.`);
  }

  app.setErrorHandler((err, _req, reply) => {
    const e = err as Error & { statusCode?: number; issues?: unknown };
    const status = e.statusCode ?? (e.name === "ZodError" ? 400 : 500);
    if (status >= 500) app.log.error(e);
    reply.code(status).send({ error: e.message, issues: e.issues });
  });

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    `source=${config.source} verify=${config.verifyMode} claude=${hasClaudeCredentials() ? "configured" : "not configured"} auth=${authEnabled() ? "basic" : "off"}`,
  );
  startScheduler();

  const shutdown = async () => {
    stopScheduler();
    await closeBrowser();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
