#!/usr/bin/env node
/**
 * Context-scaling micro-benchmark for SouthStack P2P.
 * Generates synthetic code contexts and reports chunking/routing cost.
 *
 * Usage:
 *   node southstack-p2p/tools/context_scaling_benchmark.js
 */

const SCENARIOS = [
  { name: "10k", lines: 10_000 },
  { name: "50k", lines: 50_000 },
  { name: "500k", lines: 500_000 },
];

const CHUNK_SIZE = 6_000;
const PEERS = ["host", "peer-1", "peer-2"];

function makeLine(i) {
  return `function f_${i}(){return ${i}%7===0?handleErr(${i}):compute(${i});}\n`;
}

function buildSyntheticContext(lines) {
  let out = "";
  for (let i = 0; i < lines; i += 1) out += makeLine(i);
  return out;
}

function splitLargeContextText(text, chunkChars = CHUNK_SIZE) {
  if (!text || text.length <= chunkChars) return [text || ""];
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkChars) {
    chunks.push(text.slice(i, i + chunkChars));
  }
  return chunks;
}

function routeChunks(chunks) {
  return chunks.map((chunk, idx) => ({
    id: idx,
    peer: PEERS[idx % PEERS.length],
    size: chunk.length,
  }));
}

function fmt(ms) {
  return `${ms.toFixed(2)} ms`;
}

function runOne(s) {
  const t0 = performance.now();
  const context = buildSyntheticContext(s.lines);
  const t1 = performance.now();
  const chunks = splitLargeContextText(context, CHUNK_SIZE);
  const t2 = performance.now();
  const routed = routeChunks(chunks);
  const t3 = performance.now();
  const mem = process.memoryUsage();

  return {
    scenario: s.name,
    lines: s.lines,
    chars: context.length,
    chunks: chunks.length,
    generationMs: t1 - t0,
    chunkingMs: t2 - t1,
    routingMs: t3 - t2,
    rssMb: mem.rss / (1024 * 1024),
    heapUsedMb: mem.heapUsed / (1024 * 1024),
    sampleRoute: routed.slice(0, 6),
  };
}

function printTable(results) {
  const header =
    "Scenario | Lines | Chars | Chunks | Build | Chunk | Route | RSS MB | Heap MB";
  const sep = "-".repeat(header.length);
  console.log(header);
  console.log(sep);
  for (const r of results) {
    console.log(
      `${r.scenario.padEnd(8)} | ${String(r.lines).padStart(6)} | ${String(
        r.chars
      ).padStart(7)} | ${String(r.chunks).padStart(6)} | ${fmt(r.generationMs).padStart(
        10
      )} | ${fmt(r.chunkingMs).padStart(9)} | ${fmt(r.routingMs).padStart(
        9
      )} | ${r.rssMb.toFixed(1).padStart(6)} | ${r.heapUsedMb
        .toFixed(1)
        .padStart(7)}`
    );
  }
}

function main() {
  const results = SCENARIOS.map(runOne);
  printTable(results);
  console.log("\nSample route for largest scenario:");
  console.log(results[results.length - 1].sampleRoute);
}

main();
