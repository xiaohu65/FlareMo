#!/usr/bin/env node

// Deployment checks for the owner's existing instance. Never writes resources,
// application secrets, or user data; do not use this for a new installation.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseJsonc } from "jsonc-parser";

export const PERSONAL_ORIGIN =
  "https://flaremo-personal.yangxiaohu65.workers.dev";
const ACCOUNT_ID = "87854f5abe3a625da7ebab41b00d4095";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function exactBindings(actual, expected, keys, label) {
  requireCondition(
    Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item) =>
        actual.some((entry) => keys.every((key) => entry[key] === item[key])),
      ),
    `Unexpected ${label}; refusing to change this instance's resources.`,
  );
}

export function validatePersonalConfig(source, accountId) {
  requireCondition(
    typeof source === "string" && source.trim().length > 0,
    "Missing WRANGLER_JSONC; template fallback is forbidden for this instance.",
  );
  const errors = [];
  const config = parseJsonc(source, errors, { allowTrailingComma: true });
  requireCondition(
    errors.length === 0 && config && typeof config === "object",
    "WRANGLER_JSONC must contain a valid JSONC configuration.",
  );
  requireCondition(
    accountId === ACCOUNT_ID && config.account_id === ACCOUNT_ID,
    "Cloudflare account does not match this existing instance.",
  );
  requireCondition(
    config.name === "flaremo-personal" &&
      config.main === "./apps/worker/src/index.ts" &&
      config.workers_dev === true &&
      config.preview_urls === false,
    "Worker identity or entry point does not match this existing instance.",
  );
  requireCondition(
    !config.env && !config.route && !config.routes,
    "Environment overrides and custom domain routes are not allowed here.",
  );
  requireCondition(
    config.vars?.FLAREMO_PUBLIC_URL === PERSONAL_ORIGIN &&
      config.vars?.FLAREMO_EMBEDDING_PROVIDER === "workers-ai" &&
      config.vars?.FLAREMO_EMBEDDING_MODEL ===
        "@cf/qwen/qwen3-embedding-0.6b" &&
      config.vars?.FLAREMO_EMBEDDING_DIMENSIONS === "1024" &&
      config.ai?.binding === "AI",
    "Public origin or enabled embedding configuration does not match.",
  );
  requireCondition(
    Object.entries(config.vars).every(
      ([name, value]) =>
        !/(SECRET|PASSWORD|TOKEN|PRIVATE_KEY|API_KEY)/i.test(name) || !value,
    ),
    "Application credentials must stay in Cloudflare Worker Secrets.",
  );
  exactBindings(
    config.d1_databases,
    [
      {
        binding: "DB",
        database_name: "flaremo-personal-db",
        database_id: "8aa847c6-4f7e-4e14-a412-cf5cad6021f5",
        migrations_dir: "./migrations",
      },
    ],
    ["binding", "database_name", "database_id", "migrations_dir"],
    "D1 binding",
  );
  exactBindings(
    config.r2_buckets,
    [{ binding: "ATTACHMENTS", bucket_name: "flaremo-personal-attachments" }],
    ["binding", "bucket_name"],
    "R2 binding",
  );
  exactBindings(
    config.queues?.producers,
    [
      {
        binding: "MEMBER_REMOVAL_QUEUE",
        queue: "flaremo-personal-member-removal",
      },
      { binding: "DATA_EXPORT_QUEUE", queue: "flaremo-personal-data-export" },
    ],
    ["binding", "queue"],
    "Queue producers",
  );
  exactBindings(
    config.queues?.consumers,
    [
      { queue: "flaremo-personal-member-removal" },
      { queue: "flaremo-personal-data-export" },
    ],
    ["queue"],
    "Queue consumers",
  );
  exactBindings(
    config.vectorize,
    [
      { binding: "VECTORIZE_MEMOS", index_name: "flaremo-personal-memos" },
      {
        binding: "VECTORIZE_MEMORIES",
        index_name: "flaremo-personal-memories",
      },
    ],
    ["binding", "index_name"],
    "Vectorize bindings",
  );
  const workerRoutes = [
    "/api/*",
    "/article/*",
    "/feed.xml",
    "/file/*",
    "/mcp",
    "/memory/*",
    "/openapi.json",
    "/memos.api.v1.*",
    "/share/*",
    "/sitemap.xml",
    "/sitemap-articles.xml",
    "/favicon.ico",
  ];
  requireCondition(
    config.assets?.directory === "./apps/web/dist" &&
      config.assets?.binding === "ASSETS" &&
      config.assets?.not_found_handling === "single-page-application" &&
      Array.isArray(config.assets?.run_worker_first) &&
      workerRoutes.every((route) =>
        config.assets.run_worker_first.includes(route),
      ),
    "Static assets and API/SSR routing must be preserved.",
  );
  return config;
}

export function validateSecretNames(source) {
  let secrets;
  try {
    secrets = JSON.parse(source);
  } catch {
    throw new Error("Could not read Worker secret names from Wrangler.");
  }
  requireCondition(
    Array.isArray(secrets) &&
      secrets.some((secret) => secret.name === "BETTER_AUTH_SECRET"),
    "The existing Worker must already have BETTER_AUTH_SECRET; CI will not create or replace it.",
  );
}

export async function checkPersonalSite({ fetchImpl = fetch } = {}) {
  const get = (path) =>
    fetchImpl(`${PERSONAL_ORIGIN}${path}`, {
      redirect: "manual",
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(10000),
    });
  const home = await get("/");
  requireCondition(
    home.status === 200 &&
      home.headers.get("content-type")?.includes("text/html"),
    "The production homepage must return HTTP 200 HTML without redirects.",
  );
  const bootstrap = await get("/api/auth/flaremo/bootstrap/status");
  requireCondition(
    bootstrap.status === 200,
    "Bootstrap status is unavailable.",
  );
  const status = await bootstrap.json();
  requireCondition(
    status.initialized === true &&
      status.state === "complete" &&
      status.setup_available === false,
    "The existing administrator must remain initialized and setup must remain closed.",
  );
  const registration = await get("/api/auth/flaremo/register/status");
  requireCondition(
    registration.status === 200 &&
      (await registration.json()).registration_open === false,
    "Public registration must remain closed for this personal instance.",
  );
  const anonymous = await get("/api/v1/auth/me");
  requireCondition(
    anonymous.status === 401,
    "Anonymous /api/v1/auth/me must return HTTP 401.",
  );
}

async function main() {
  const mode = process.argv[2];
  if (mode === "config") {
    validatePersonalConfig(
      process.env.WRANGLER_JSONC,
      process.env.CLOUDFLARE_ACCOUNT_ID,
    );
    console.log("Existing instance configuration verified.");
  } else if (mode === "secrets") {
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "secret",
        "list",
        "--config",
        "./wrangler.jsonc",
        "--format",
        "json",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    requireCondition(
      result.status === 0,
      "Unable to verify existing Worker secret names. Check the Cloudflare API token permissions.",
    );
    validateSecretNames(result.stdout);
    console.log(
      "Existing authentication secret verified by name; its value is not read or changed.",
    );
  } else if (mode === "smoke") {
    await checkPersonalSite();
    console.log(
      "Production HTML, completed initialization, closed registration, and anonymous authentication boundary verified.",
    );
  } else {
    throw new Error(
      "Usage: node scripts/personal-deploy-check.mjs config|secrets|smoke",
    );
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Personal deployment check failed.",
    );
    process.exitCode = 1;
  });
}
