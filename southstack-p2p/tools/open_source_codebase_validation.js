#!/usr/bin/env node
/**
 * Open-source codebase validation for SouthStack P2P.
 * Measures line counts and context-sharding metrics.
 */

const fs = require("fs");
const path = require("path");

const TARGET = process.argv[2] || path.resolve(process.cwd(), "external/redis");
const ALLOWED = new Set([
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".js",
  ".ts",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".md",
  ".sh",
]);
const CHUNK_CHARS = 6000;
const PEERS = ["host", "peer-1", "peer-2"];

function walk(dir, out = []) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const it of items) {
    if (it.name === ".git" || it.name === "node_modules") continue;
    const p = path.join(dir, it.name);
    if (it.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function countLines(text) {
  if (!text) return 0;
  return text.split("\n").length;
}

function splitChunks(text, size = CHUNK_CHARS) {
  if (text.length <= size) return [text];
  const chunks = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

function route(chunks) {
  return chunks.map((c, i) => ({ id: i, peer: PEERS[i % PEERS.length], size: c.length }));
}

function takeScenario(linesTarget, files) {
  let lines = 0;
  let chars = 0;
  let context = "";
  let used = 0;
  for (const f of files) {
    if (lines >= linesTarget) break;
    const txt = fs.readFileSync(f, "utf8");
    context += `\n// FILE: ${f}\n${txt}`;
    lines += countLines(txt);
    chars += txt.length;
    used += 1;
  }
  let augmented = false;
  if (lines < linesTarget && context.length > 0) {
    // If repository is smaller than target size, repeat collected corpus to hit requested scale.
    const baseBlock = context;
    while (lines < linesTarget) {
      context += `\n// AUGMENTED_REPEAT\n${baseBlock}`;
      lines += countLines(baseBlock);
      chars += baseBlock.length;
      augmented = true;
    }
  }
  const t0 = performance.now();
  const chunks = splitChunks(context, CHUNK_CHARS);
  const t1 = performance.now();
  const routed = route(chunks);
  const t2 = performance.now();
  return {
    target_lines: linesTarget,
    actual_lines: lines,
    actual_chars: chars,
    used_files: used,
    augmented,
    chunks: chunks.length,
    chunk_ms: Number((t1 - t0).toFixed(2)),
    route_ms: Number((t2 - t1).toFixed(2)),
    sample_route: routed.slice(0, 6),
  };
}

function main() {
  if (!fs.existsSync(TARGET)) {
    console.error(`Target repo not found: ${TARGET}`);
    process.exit(1);
  }
  const all = walk(TARGET).filter(f => ALLOWED.has(path.extname(f).toLowerCase()));
  all.sort();
  const scenarios = [10_000, 50_000, 500_000].map(n => takeScenario(n, all));
  const out = {
    target_repo: TARGET,
    file_count: all.length,
    scenarios,
    generated_at: new Date().toISOString(),
  };
  console.log(JSON.stringify(out, null, 2));
}

main();
