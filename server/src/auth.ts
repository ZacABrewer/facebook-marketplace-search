/**
 * Optional HTTP basic auth, enabled by setting both AUTH_USER and AUTH_PASS.
 * Off by default so local use is unchanged; strongly recommended whenever the
 * server is reachable from anything wider than your own machine.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authEnabled, config } from "./config.js";

/** Public paths that must stay reachable for container health checks. */
const PUBLIC_PATHS = new Set(["/api/health"]);

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** Constant-time compare of two arbitrary-length strings. */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function checkBasicAuth(header: string | undefined): boolean {
  if (!header || !header.toLowerCase().startsWith("basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6).trim(), "base64").toString("utf8");
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  // Always compare both so a wrong username costs the same as a wrong password.
  const userOk = safeEqual(user, config.authUser);
  const passOk = safeEqual(pass, config.authPass);
  return userOk && passOk;
}

export function registerAuth(app: FastifyInstance): void {
  if (!authEnabled()) return;
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split("?")[0];
    if (PUBLIC_PATHS.has(path)) return;
    if (checkBasicAuth(req.headers.authorization)) return;
    reply
      .code(401)
      .header("WWW-Authenticate", 'Basic realm="Marketplace Search", charset="UTF-8"')
      .send({ error: "Authentication required" });
  });
  app.log.info("HTTP basic auth is enabled");
}
