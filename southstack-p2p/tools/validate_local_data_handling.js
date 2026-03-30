#!/usr/bin/env node
/**
 * Static validation of local-only data handling assumptions.
 * Focus: ensure coding payloads are not sent to non-local HTTP endpoints.
 */

const fs = require("fs");
const path = require("path");

const target = path.resolve(process.cwd(), "southstack-p2p/main.js");
const src = fs.readFileSync(target, "utf8");
const lines = src.split("\n");

const endpointFindings = [];
const risks = [];

for (let i = 0; i < lines.length; i += 1) {
  const ln = lines[i];
  const m = ln.match(/fetch\((['"`])(https?:\/\/[^'"`]+)\1/);
  if (!m) continue;
  const url = m[2];
  const windowText = lines.slice(i, Math.min(lines.length, i + 12)).join("\n").toLowerCase();
  const hasTaskLike = /task|prompt|payload|subtask|state|originalprompt|llmchat/.test(windowText);
  const isLocal = /127\.0\.0\.1|localhost/.test(url);
  endpointFindings.push({
    line: i + 1,
    url,
    local: isLocal,
    context_has_task_like_fields: hasTaskLike,
  });
  if (!isLocal && hasTaskLike) {
    risks.push({
      line: i + 1,
      url,
      issue: "Potential task/prompt payload to non-local endpoint",
    });
  }
}

const result = {
  target_file: "southstack-p2p/main.js",
  external_endpoint_count: endpointFindings.filter(e => !e.local).length,
  local_endpoint_count: endpointFindings.filter(e => e.local).length,
  endpoints: endpointFindings,
  risks,
  pass: risks.length === 0,
  generated_at: new Date().toISOString(),
};

console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exit(2);
