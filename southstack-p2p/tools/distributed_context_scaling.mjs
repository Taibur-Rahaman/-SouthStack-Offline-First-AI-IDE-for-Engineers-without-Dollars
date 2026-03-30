#!/usr/bin/env node
/**
 * Real-world-ish context scaling and distribution benchmark.
 * Scenarios: 10k, 50k, 100k, 500k lines (500k is Linux-scale synthetic; use --repo for real trees).
 * Strategies: file-based + function-based chunking
 */

import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

const ROOT = path.resolve(process.cwd(), "southstack-p2p");
const DATA_ROOT = path.resolve(ROOT, "sample_codebase_scaling");
const OUTPUT = path.resolve(ROOT, "DISTRIBUTED_CONTEXT_SCALING_RESULTS.json");
const PEERS = ["peer-1", "peer-2", "peer-3"];
const SCENARIOS = [10_000, 50_000, 100_000, 500_000];
const SOURCE_EXT = new Set([".js", ".ts", ".tsx", ".jsx", ".py", ".go", ".java", ".c", ".cc", ".cpp", ".h", ".hpp", ".rs"]);

function parseArgs(argv) {
  const out = { repo: "" };
  for (const arg of argv) {
    if (arg.startsWith("--repo=")) out.repo = arg.slice("--repo=".length);
  }
  return out;
}

function makeFunction(fileIdx, fnIdx) {
  return [
    `export function file${fileIdx}_fn${fnIdx}(input) {`,
    "  const parts = String(input).split(':');",
    "  return parts[0] + '-' + (parts[1] || '');",
    "}",
  ].join("\n");
}

async function buildScenario(totalLines) {
  const dir = path.resolve(DATA_ROOT, `${totalLines}`);
  await fs.mkdir(dir, { recursive: true });
  const files = [];
  const linesPerFile = 1000;
  const fileCount = Math.max(1, Math.ceil(totalLines / linesPerFile));
  for (let i = 0; i < fileCount; i += 1) {
    const blocks = [];
    blocks.push(`// scenario ${totalLines}, file ${i}`);
    let lineBudget = linesPerFile - 1;
    let fn = 0;
    while (lineBudget > 4) {
      blocks.push(makeFunction(i, fn));
      blocks.push(`export const marker_${i}_${fn} = ${fn};`);
      lineBudget -= 5;
      fn += 1;
    }
    const file = path.resolve(dir, `mod_${String(i).padStart(3, "0")}.js`);
    await fs.writeFile(file, `${blocks.join("\n")}\n`, "utf8");
    files.push(file);
  }
  return files;
}

async function listSourceFilesRecursive(root, acc = []) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const e of entries) {
    const abs = path.join(root, e.name);
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "node_modules" || e.name === "dist" || e.name === "build") continue;
      await listSourceFilesRecursive(abs, acc);
      continue;
    }
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (SOURCE_EXT.has(ext)) acc.push(abs);
  }
  return acc;
}

async function buildScenarioFromRepo(repoPath, totalLines) {
  const absRepo = path.resolve(process.cwd(), repoPath);
  const files = await listSourceFilesRecursive(absRepo);
  const dir = path.resolve(DATA_ROOT, `repo_${totalLines}`);
  await fs.mkdir(dir, { recursive: true });
  const selected = [];
  let consumed = 0;
  let idx = 0;
  for (const f of files) {
    if (consumed >= totalLines) break;
    const txt = await fs.readFile(f, "utf8");
    const lines = txt.split("\n");
    const remaining = totalLines - consumed;
    const slice = lines.slice(0, Math.max(1, remaining)).join("\n");
    const out = path.resolve(dir, `mod_${String(idx++).padStart(4, "0")}${path.extname(f) || ".txt"}`);
    await fs.writeFile(out, `${slice}\n`, "utf8");
    selected.push(out);
    consumed += Math.min(lines.length, remaining);
  }
  return selected;
}

async function readFiles(files) {
  const out = [];
  for (const file of files) {
    out.push({
      file: path.relative(ROOT, file),
      text: await fs.readFile(file, "utf8"),
    });
  }
  return out;
}

function fileBasedChunks(modules) {
  return modules.map((m, idx) => ({
    id: `f-${idx}`,
    strategy: "file-based",
    file: m.file,
    payload: m.text,
  }));
}

function functionBasedChunks(modules) {
  const chunks = [];
  let id = 0;
  for (const m of modules) {
    const pieces = m.text.split(/\n(?=export function )/g);
    for (const p of pieces) {
      const trimmed = p.trim();
      if (!trimmed) continue;
      chunks.push({
        id: `fn-${id++}`,
        strategy: "function-based",
        file: m.file,
        payload: trimmed,
      });
    }
  }
  return chunks;
}

function distribute(chunks) {
  return chunks.map((c, i) => ({ ...c, peer: PEERS[i % PEERS.length] }));
}

function evaluateAccuracy(chunks) {
  let bugPatternHits = 0;
  for (const c of chunks) {
    if (c.payload.includes("split(':')")) bugPatternHits += 1;
  }
  return {
    bugPatternHits,
    totalChunks: chunks.length,
    accuracyScore: chunks.length ? bugPatternHits / chunks.length : 0,
  };
}

function summarizeDistribution(routed) {
  const byPeer = { "peer-1": 0, "peer-2": 0, "peer-3": 0 };
  for (const r of routed) byPeer[r.peer] += 1;
  const counts = Object.values(byPeer);
  const max = Math.max(...counts);
  const min = Math.min(...counts);
  return {
    byPeer,
    spread: max - min,
    efficient: max - min <= 1,
  };
}

async function runScenario(lines, repoPath = "") {
  const t0 = performance.now();
  const files = repoPath ? await buildScenarioFromRepo(repoPath, lines) : await buildScenario(lines);
  const modules = await readFiles(files);
  const t1 = performance.now();

  const fChunks = fileBasedChunks(modules);
  const t2 = performance.now();
  const fRouted = distribute(fChunks);
  const t3 = performance.now();

  const fnChunks = functionBasedChunks(modules);
  const t4 = performance.now();
  const fnRouted = distribute(fnChunks);
  const t5 = performance.now();

  return {
    lines,
    buildMs: t1 - t0,
    fileBased: {
      chunkMs: t2 - t1,
      routeMs: t3 - t2,
      chunks: fChunks.length,
      distribution: summarizeDistribution(fRouted),
      accuracy: evaluateAccuracy(fChunks),
    },
    functionBased: {
      chunkMs: t4 - t3,
      routeMs: t5 - t4,
      chunks: fnChunks.length,
      distribution: summarizeDistribution(fnRouted),
      accuracy: evaluateAccuracy(fnChunks),
    },
    totalMs: t5 - t0,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(DATA_ROOT, { recursive: true });
  const scenarios = [];
  for (const lines of SCENARIOS) {
    scenarios.push(await runScenario(lines, args.repo));
  }
  const out = {
    pass: scenarios.every((s) => s.fileBased.distribution.efficient && s.functionBased.distribution.efficient),
    source: args.repo ? "external-repo" : "synthetic",
    source_repo: args.repo ? path.resolve(process.cwd(), args.repo) : null,
    scenarios,
    generated_at: new Date().toISOString(),
  };
  await fs.writeFile(OUTPUT, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(out, null, 2));
}

await main();
