#!/usr/bin/env node
/**
 * End-to-end distributed demo pipeline.
 * Usage:
 *   node southstack-p2p/tools/run_debug_distributed.mjs --distributed
 *   node southstack-p2p/tools/run_debug_distributed.mjs --distributed --repo=./path --quiet-json
 */

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";

const ROOT = path.resolve(process.cwd(), "southstack-p2p/tools");
const OUT = path.resolve(process.cwd(), "southstack-p2p/DISTRIBUTED_DEBUG_DEMO_RESULTS.json");
const DEBUG_OUT = path.resolve(process.cwd(), "southstack-p2p/BROWSER_AGENTIC_DEBUG_RESULTS.json");
const SCALE_OUT = path.resolve(process.cwd(), "southstack-p2p/DISTRIBUTED_CONTEXT_SCALING_RESULTS.json");
const SINGLE_OUT = path.resolve(process.cwd(), "southstack-p2p/SINGLE_NODE_DEBUG_RESULTS.json");

function runNode(script, args = [], env = {}) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += String(d); });
    proc.stderr.on("data", (d) => { stderr += String(d); });
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function readJsonFile(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

function fmtMs(v) {
  return Number(v || 0).toFixed(2);
}

const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function color(text, code) {
  return process.stdout.isTTY ? `${code}${text}${C.reset}` : text;
}

function statusColor(status) {
  if (status === "done" || status === "ok" || status === "success") return C.green;
  if (status === "failed" || status === "error") return C.red;
  return C.yellow;
}

function bar(value, max, width = 10) {
  if (max <= 0) return `[${" ".repeat(width)}]`;
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return `[${"█".repeat(filled)}${" ".repeat(width - filled)}]`;
}

function printPeerTable(perPeerStats = {}) {
  const rows = Object.entries(perPeerStats).map(([peer, stat]) => ({
    peer,
    tasks: stat.tasks ?? 0,
    time: stat.time_ms ?? 0,
    status: stat.status || "done",
  }));
  const headers = ["PEER", "TASKS", "TIME(ms)", "STATUS"];
  const w = {
    peer: Math.max(headers[0].length, ...rows.map((r) => r.peer.length), 6),
    tasks: Math.max(headers[1].length, ...rows.map((r) => String(r.tasks).length), 5),
    time: Math.max(headers[2].length, ...rows.map((r) => fmtMs(r.time).length), 8),
    status: Math.max(headers[3].length, ...rows.map((r) => r.status.length), 6),
  };
  const headerLine = `${headers[0].padEnd(w.peer)}  ${headers[1].padStart(w.tasks)}  ${headers[2].padStart(w.time)}  ${headers[3].padEnd(w.status)}`;
  const sep = "-".repeat(headerLine.length);
  console.log(color(headerLine, C.cyan));
  console.log(color(sep, C.dim));
  for (const r of rows) {
    const s = color(r.status.padEnd(w.status), statusColor(r.status));
    console.log(`${r.peer.padEnd(w.peer)}  ${String(r.tasks).padStart(w.tasks)}  ${fmtMs(r.time).padStart(w.time)}  ${s}`);
  }
  const maxTasks = Math.max(...rows.map((r) => r.tasks), 0);
  if (rows.length) {
    console.log("");
    for (const r of rows) {
      const b = bar(r.tasks, maxTasks, 10);
      console.log(`${r.peer} ${color(b, C.cyan)} ${r.tasks} tasks`);
    }
  }
}

async function main() {
  const distributed = process.argv.includes("--distributed");
  const quietJson = process.argv.includes("--quiet-json");
  const repoArg = process.argv.find((a) => a.startsWith("--repo=")) || "";
  const repoArgs = repoArg ? [repoArg] : [];
  if (!distributed) {
    console.error("Missing --distributed flag.");
    process.exit(2);
  }

  const debugRun = await runNode(path.resolve(ROOT, "agentic_debugger.mjs"), [...repoArgs, "--peers=3"], {
    ENABLE_SIM_FALLBACK: "0",
    PEER3_FORCE_REAL: "1",
    DEBUG_PROGRESS: "0",
  });
  const distributedJson = await readJsonFile(DEBUG_OUT);
  if (distributedJson) await fs.writeFile(DEBUG_OUT, `${JSON.stringify(distributedJson, null, 2)}\n`, "utf8");

  const singleRun = await runNode(path.resolve(ROOT, "agentic_debugger.mjs"), [...repoArgs, "--peers=1"], {
    ENABLE_SIM_FALLBACK: "0",
    PEER3_FORCE_REAL: "1",
    DEBUG_PROGRESS: "0",
  });
  const singleJson = await readJsonFile(DEBUG_OUT);
  if (singleJson) await fs.writeFile(SINGLE_OUT, `${JSON.stringify(singleJson, null, 2)}\n`, "utf8");
  const scaleRun = await runNode(path.resolve(ROOT, "distributed_context_scaling.mjs"), repoArgs);

  const scaleJson = await readJsonFile(SCALE_OUT);
  // Restore distributed artifact as canonical debug output.
  if (distributedJson) await fs.writeFile(DEBUG_OUT, `${JSON.stringify(distributedJson, null, 2)}\n`, "utf8");

  const singleMs = Number(singleJson?.elapsed_ms || 0);
  const distMs = Number(distributedJson?.elapsed_ms || 0);
  const speedup = distMs > 0 ? Number((singleMs / distMs).toFixed(2)) : 0;
  const peerTimes = Object.values(distributedJson?.per_peer_stats || {}).map((p) => Number(p.time_ms || 0));
  const serialPeerMs = peerTimes.reduce((a, b) => a + b, 0);
  const parallelPeerMs = peerTimes.length ? Math.max(...peerTimes) : 0;
  const estimatedParallelSpeedup = parallelPeerMs > 0
    ? Number((serialPeerMs / parallelPeerMs).toFixed(2))
    : 0;
  const comparison = {
    single_node_time_ms: singleMs,
    distributed_time_ms: distMs,
    speedup_x: speedup,
    estimated_parallel_speedup_x: estimatedParallelSpeedup,
  };

  const result = {
    pass:
      debugRun.code === 0
      && singleRun.code === 0
      && scaleRun.code === 0
      && !!distributedJson?.pass
      && !!singleJson?.pass
      && !!scaleJson?.pass,
    command: "run-debug --distributed",
    repo: repoArg ? repoArg.replace("--repo=", "") : null,
    summary: {
      total_files_processed: distributedJson?.total_files_processed ?? 0,
      total_lines_processed: distributedJson?.total_lines_processed ?? 0,
      issues_found: distributedJson?.total_issues_found ?? 0,
      fixes_suggested: distributedJson?.total_fixes_suggested ?? 0,
      time_saved_percent: distributedJson?.estimated_time_saved_vs_single_node_pct ?? 0,
      mode: distributedJson?.mode || "unknown",
      per_peer_stats: distributedJson?.per_peer_stats || {},
    },
    comparison,
    debug: {
      exitCode: debugRun.code,
      result: distributedJson,
      stderr: debugRun.stderr || "",
    },
    single_node: {
      exitCode: singleRun.code,
      result: singleJson,
      stderr: singleRun.stderr || "",
    },
    scaling: {
      exitCode: scaleRun.code,
      result: scaleJson,
      stderr: scaleRun.stderr || "",
    },
    generated_at: new Date().toISOString(),
  };

  await fs.writeFile(OUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log("");
  printPeerTable(result.summary.per_peer_stats);
  console.log("");
  console.log(`${color("Total Files:", C.cyan)} ${result.summary.total_files_processed}`);
  console.log(`${color("Issues Found:", C.cyan)} ${result.summary.issues_found}`);
  console.log(`${color("Time Saved:", C.cyan)} ${result.summary.time_saved_percent}%`);
  console.log(`${color("Mode:", C.cyan)} ${result.summary.mode}`);
  console.log(`${color("Single Node Time:", C.cyan)} ${fmtMs(result.comparison.single_node_time_ms)}ms`);
  console.log(`${color("Distributed Time:", C.cyan)} ${fmtMs(result.comparison.distributed_time_ms)}ms`);
  console.log(`${color("Speedup:", C.cyan)} ${result.comparison.speedup_x}x`);
  console.log(`${color("Estimated Parallel Speedup:", C.cyan)} ${result.comparison.estimated_parallel_speedup_x}x`);
  console.log("");
  if (!quietJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(color(`Full JSON written to: ${OUT}`, C.dim));
  }
  if (!result.pass) process.exit(2);
}

await main();
