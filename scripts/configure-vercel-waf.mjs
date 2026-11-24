#!/usr/bin/env node
/**
 * Preview or apply a conservative Vercel WAF policy.
 *
 * Dry-run by default. Applying requires VERCEL_TOKEN and VERCEL_PROJECT_ID.
 * Existing managed rules, IP lists, bots, and unrelated custom rules are
 * preserved; only the named OpenContext rules are upserted.
 */

import process from "node:process";

function integerEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const prefixes = [
  "OpenContext: auth burst",
  "OpenContext: URL import burst",
  "OpenContext: worker burst",
];

const desiredRules = [
  {
    name: prefixes[0],
    description: "Extra edge protection for OAuth and session endpoints.",
    active: true,
    conditionGroup: [{ conditions: [{ type: "path", op: "pre", value: "/api/auth/" }] }],
    action: {
      mitigate: {
        action: "rate_limit",
        rateLimit: {
          algo: "fixed_window",
          window: 60,
          limit: integerEnv("WAF_AUTH_LIMIT_PER_MINUTE", 120),
          keys: ["ip"],
          action: "rate_limit",
        },
      },
    },
  },
  {
    name: prefixes[1],
    description: "Bound unauthenticated URL-import acquisition attempts per address.",
    active: true,
    conditionGroup: [
      {
        conditions: [
          { type: "path", op: "eq", value: "/api/imports/url" },
          { type: "method", op: "eq", value: "POST" },
        ],
      },
    ],
    action: {
      mitigate: {
        action: "rate_limit",
        rateLimit: {
          algo: "fixed_window",
          window: 3600,
          limit: integerEnv("WAF_URL_IMPORT_LIMIT_PER_HOUR", 30),
          keys: ["ip"],
          action: "rate_limit",
        },
      },
    },
  },
  {
    name: prefixes[2],
    description: "Stop runaway worker loops before they reach application code.",
    active: true,
    conditionGroup: [{ conditions: [{ type: "path", op: "pre", value: "/api/worker/" }] }],
    action: {
      mitigate: {
        action: "rate_limit",
        rateLimit: {
          algo: "fixed_window",
          window: 60,
          limit: integerEnv("WAF_WORKER_LIMIT_PER_MINUTE", 1200),
          keys: ["ip"],
          action: "rate_limit",
        },
      },
    },
  },
];

const denyManaged = {
  sd: { active: true, action: "deny" },
  ma: { active: true, action: "deny" },
  lfi: { active: true, action: "deny" },
  rfi: { active: true, action: "deny" },
  rce: { active: true, action: "deny" },
  php: { active: true, action: "deny" },
  gen: { active: true, action: "log" },
  xss: { active: true, action: "deny" },
  sqli: { active: true, action: "deny" },
  sf: { active: true, action: "deny" },
  java: { active: true, action: "deny" },
};

function mergedConfig(current = {}) {
  const existingRules = Array.isArray(current.rules) ? current.rules : [];
  const byName = new Map(existingRules.map((rule) => [rule.name, rule]));
  for (const rule of desiredRules) {
    byName.set(rule.name, { ...(byName.get(rule.name) || {}), ...rule });
  }
  return {
    firewallEnabled: true,
    ...(current.managedRules ? { managedRules: current.managedRules } : {}),
    crs: { ...(current.crs || {}), ...denyManaged },
    rules: [...byName.values()],
    ...(current.rulesets ? { rulesets: current.rulesets } : {}),
    ...(current.ips ? { ips: current.ips } : {}),
    ...(current.botIdEnabled !== undefined ? { botIdEnabled: current.botIdEnabled } : {}),
    ...(current.logHeaders ? { logHeaders: current.logHeaders } : {}),
  };
}

function endpoint(projectId) {
  const url = new URL("https://api.vercel.com/v1/security/firewall/config");
  url.searchParams.set("projectId", projectId);
  if (process.env.VERCEL_TEAM_ID) url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
  if (process.env.VERCEL_TEAM_SLUG) url.searchParams.set("slug", process.env.VERCEL_TEAM_SLUG);
  return url;
}

async function api(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Vercel API ${options.method || "GET"} ${response.status}: ${body?.error?.message || response.statusText}`);
  }
  return body;
}

if (process.argv.includes("--print")) {
  console.log(JSON.stringify(mergedConfig(), null, 2));
  process.exit(0);
}

const token = process.env.VERCEL_TOKEN?.trim();
const projectId = process.env.VERCEL_PROJECT_ID?.trim();
if (!token || !projectId) {
  throw new Error("Set VERCEL_TOKEN and VERCEL_PROJECT_ID (and optional team scope variables).");
}
const url = endpoint(projectId);
const currentResponse = await api(url, token);
const config = mergedConfig(currentResponse.active || currentResponse);
const apply = process.argv.includes("--apply");
if (!apply) {
  console.log(JSON.stringify(config, null, 2));
  console.error("Dry run only. Re-run with --apply to publish the firewall configuration.");
  process.exit(0);
}
const result = await api(url, token, {
  method: "PUT",
  body: JSON.stringify(config),
});
console.log(JSON.stringify({
  applied: true,
  projectId,
  firewallEnabled: result.active?.firewallEnabled ?? result.firewallEnabled ?? true,
  rules: result.active?.rules?.length ?? result.rules?.length ?? config.rules.length,
}, null, 2));
