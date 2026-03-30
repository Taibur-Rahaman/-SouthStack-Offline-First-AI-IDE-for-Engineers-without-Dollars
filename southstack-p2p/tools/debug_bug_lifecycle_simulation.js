#!/usr/bin/env node
/**
 * Simulated distributed debugging lifecycle validation.
 * Verifies stage split and merge behavior for one full bug cycle.
 */

function buildDebugStages(issue) {
  return [
    { stage: "reproduce", owner: "peer-1", output: `Reproduced: ${issue}` },
    { stage: "analyze", owner: "peer-2", output: "Root cause: missing null check in parser" },
    { stage: "patch", owner: "peer-1", output: "Patch: add guard + unit-safe fallback branch" },
    { stage: "verify", owner: "peer-2", output: "Regression checks: 6 pass, 0 fail" },
  ];
}

function merge(stages) {
  return stages.map(s => `[${s.stage}@${s.owner}] ${s.output}`).join("\n");
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function run() {
  const issue = "failing test in command parser under concurrent input";
  const stages = buildDebugStages(issue);
  assert(stages.length === 4, "expected 4 debugging stages");
  const merged = merge(stages);
  assert(merged.includes("reproduce"), "missing reproduce stage");
  assert(merged.includes("analyze"), "missing analyze stage");
  assert(merged.includes("patch"), "missing patch stage");
  assert(merged.includes("verify"), "missing verify stage");

  const result = {
    pass: true,
    issue,
    stage_count: stages.length,
    stages,
    merged_output: merged,
    generated_at: new Date().toISOString(),
  };
  console.log(JSON.stringify(result, null, 2));
}

run();
