import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
const repoRoot = path.resolve(serverRoot, "..");

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v == null || v === "" ? fallback : v;
}

export const config = {
  port: Number(env("PORT", "4310")),
  host: env("HOST", "127.0.0.1"),
  dataDir: env("DATA_DIR", path.join(serverRoot, "data")),
  webDist: env("WEB_DIST", path.join(repoRoot, "web", "dist")),
  /** "demo" generates realistic synthetic listings; "facebook" scrapes Marketplace with Playwright. */
  source: env("SOURCE", "demo") as "demo" | "facebook",
  /** Optional path to a cookies file exported from a logged-in Facebook session (JSON array or Netscape format). */
  facebookCookies: env("FB_COOKIES", ""),
  /** Chromium executable override for Playwright (leave empty to use Playwright's own browser). */
  chromiumPath: env("CHROMIUM_PATH", ""),
  headless: env("HEADLESS", "true") !== "false",
  /**
   * Chromium's setuid sandbox cannot start in most containers. The Docker image
   * sets this to "true"; leave it off when running directly on a desktop.
   */
  chromiumNoSandbox: env("CHROMIUM_NO_SANDBOX", "false") === "true",
  /** Optional HTTP basic auth. Both must be set for auth to be enforced. */
  authUser: env("AUTH_USER", ""),
  authPass: env("AUTH_PASS", ""),
  /** Claude model used for the photo + description cross-check. */
  claudeModel: env("CLAUDE_MODEL", "claude-opus-5"),
  /** "ambiguous" checks only listings the keyword scorer is unsure about, "all" checks everything, "off" disables. */
  verifyMode: env("VERIFY_MODE", "ambiguous") as "ambiguous" | "all" | "off",
  verifyConcurrency: Number(env("VERIFY_CONCURRENCY", "2")),
  schedulerTickSeconds: Number(env("SCHEDULER_TICK_SECONDS", "60")),
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
};

export function hasClaudeCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function authEnabled(): boolean {
  return Boolean(config.authUser && config.authPass);
}

export function ensureDataDir(): void {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.accessSync(config.dataDir, fs.constants.W_OK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new Error(
      `Cannot write to DATA_DIR "${config.dataDir}" (${code ?? "error"}). ` +
        "In Docker this usually means the mounted volume is owned by a different user: " +
        "either chown the host folder to the container's user, or set the container's user to match it " +
        "(see the Docker section of the README).",
    );
  }
}
