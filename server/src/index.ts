import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { runMigrations } from "./db.js";
import { uploadRoutes } from "./routes/upload.js";
import { indicadoresRoutes } from "./routes/indicadores.js";
import { sacsRoutes } from "./routes/sacs.js";
import { cncRoutes } from "./routes/cnc.js";
import { acicRoutes } from "./routes/acic.js";

const fastify = Fastify({ logger: true });

async function start() {
  await fastify.register(cors, { origin: true });
  await fastify.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } }); // 50 MB

  await runMigrations();

  await fastify.register(indicadoresRoutes, { prefix: "/api/v1" });
  await fastify.register(uploadRoutes, { prefix: "/api/v1" });
  await fastify.register(sacsRoutes, { prefix: "/api/v1" });
  await fastify.register(cncRoutes, { prefix: "/api/v1" });
  await fastify.register(acicRoutes, { prefix: "/api/v1" });

  fastify.get("/api/v1/health", async () => ({ ok: true }));

  await fastify.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`API rodando em http://localhost:${config.port}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
