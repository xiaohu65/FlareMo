import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse as parseJsonc } from "jsonc-parser";
import {
  checkPersonalSite,
  PERSONAL_ORIGIN,
  validatePersonalConfig,
  validateSecretNames,
} from "./personal-deploy-check.mjs";

const accountId = "87854f5abe3a625da7ebab41b00d4095";

function configFixture() {
  const config = parseJsonc(
    readFileSync(new URL("../wrangler.jsonc.example", import.meta.url), "utf8"),
  );
  config.account_id = accountId;
  config.name = "flaremo-personal";
  config.workers_dev = true;
  config.preview_urls = false;
  config.vars.FLAREMO_PUBLIC_URL = PERSONAL_ORIGIN;
  config.d1_databases[0].database_name = "flaremo-personal-db";
  config.d1_databases[0].database_id = "8aa847c6-4f7e-4e14-a412-cf5cad6021f5";
  config.r2_buckets[0].bucket_name = "flaremo-personal-attachments";
  for (const producer of config.queues.producers) {
    producer.queue = producer.queue.replace("flaremo-", "flaremo-personal-");
  }
  for (const consumer of config.queues.consumers) {
    consumer.queue = consumer.queue.replace("flaremo-", "flaremo-personal-");
  }
  for (const index of config.vectorize) {
    index.index_name = index.index_name.replace(
      "flaremo-",
      "flaremo-personal-",
    );
  }
  config.assets.run_worker_first = [
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
  return config;
}

test("requires the full config and the correct account without template fallback", () => {
  for (const value of [undefined, "", "  ", "{broken", "null"]) {
    assert.throws(() => validatePersonalConfig(value, accountId));
  }
  const config = configFixture();
  assert.equal(
    validatePersonalConfig(JSON.stringify(config), accountId).name,
    "flaremo-personal",
  );
  assert.throws(
    () => validatePersonalConfig(JSON.stringify(config), "another-account"),
    /account/,
  );
});

test("rejects resource drift, missing bindings, and extra resource entries", () => {
  const changes = [
    (config) => {
      config.name = "flaremo";
    },
    (config) => {
      config.account_id = "another-account";
    },
    (config) => {
      config.d1_databases[0].database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID";
    },
    (config) => {
      config.d1_databases[0].migrations_dir = "./other-migrations";
    },
    (config) => {
      config.r2_buckets[0].bucket_name = "other-attachments";
    },
    (config) => {
      config.r2_buckets.push({ binding: "OTHER", bucket_name: "other" });
    },
    (config) => {
      config.queues.producers[0].queue = "another-queue";
    },
    (config) => {
      config.queues.consumers.pop();
    },
    (config) => {
      config.vectorize[0].index_name = "another-index";
    },
    (config) => {
      config.ai.binding = "OTHER_AI";
    },
  ];
  for (const change of changes) {
    const config = configFixture();
    change(config);
    assert.throws(() =>
      validatePersonalConfig(JSON.stringify(config), accountId),
    );
  }
});

test("rejects routing, embedding, and application secret mistakes", () => {
  const changes = [
    (config) => {
      config.route = "example.com/*";
    },
    (config) => {
      config.env = { production: {} };
    },
    (config) => {
      config.vars.FLAREMO_PUBLIC_URL = "https://another.workers.dev";
    },
    (config) => {
      config.vars.FLAREMO_EMBEDDING_PROVIDER = "none";
    },
    (config) => {
      config.vars.FLAREMO_EMBEDDING_DIMENSIONS = "768";
    },
    (config) => {
      config.assets.run_worker_first = ["/api/*"];
    },
    (config) => {
      config.vars.BETTER_AUTH_SECRET = "test-only-placeholder";
    },
    (config) => {
      config.vars.FLAREMO_BOOTSTRAP_SECRET = "test-only-placeholder";
    },
    (config) => {
      config.vars.FLAREMO_OPERATOR_RECOVERY_SECRET = "test-only-placeholder";
    },
  ];
  for (const change of changes) {
    const config = configFixture();
    change(config);
    assert.throws(() =>
      validatePersonalConfig(JSON.stringify(config), accountId),
    );
  }
});

test("existing authentication secret is required but bootstrap secret is not", () => {
  validateSecretNames(
    JSON.stringify([{ name: "BETTER_AUTH_SECRET", type: "secret_text" }]),
  );
  for (const source of [
    "[]",
    "null",
    "not-json",
    '[{"name":"UNRELATED_SECRET"}]',
  ]) {
    assert.throws(() => validateSecretNames(source));
  }
});

function mockFetch(overrides = {}) {
  return async (url, options) => {
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    const path = new URL(url).pathname;
    if (path === "/") {
      return new Response("<html>FlareMo</html>", {
        status: overrides.homeStatus ?? 200,
        headers: { "content-type": overrides.homeType ?? "text/html" },
      });
    }
    if (path === "/api/auth/flaremo/bootstrap/status") {
      return Response.json(
        overrides.bootstrap ?? {
          initialized: true,
          state: "complete",
          setup_available: false,
        },
      );
    }
    if (path === "/api/auth/flaremo/register/status") {
      return Response.json({
        registration_open: overrides.registrationOpen ?? false,
      });
    }
    assert.equal(path, "/api/v1/auth/me");
    return Response.json(
      { error: "Unauthorized" },
      { status: overrides.authStatus ?? 401 },
    );
  };
}

test("read-only smoke checks HTML, initialized administrator, closed registration, and anonymous 401", async () => {
  await checkPersonalSite({ fetchImpl: mockFetch() });
});

test("smoke rejects a missing site, redirect, API routing fallback, or public user data", async () => {
  for (const overrides of [
    { homeStatus: 404 },
    { homeStatus: 302 },
    { homeType: "application/json" },
    {
      bootstrap: { initialized: false, state: "ready", setup_available: true },
    },
    {
      bootstrap: {
        initialized: true,
        state: "complete",
        setup_available: true,
      },
    },
    { authStatus: 200 },
    { authStatus: 404 },
    { registrationOpen: true },
  ]) {
    await assert.rejects(
      checkPersonalSite({ fetchImpl: mockFetch(overrides) }),
    );
  }
});
