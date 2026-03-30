#!/usr/bin/env node
/**
 * Regression checks for distributed debug pipeline planning behavior.
 */

function isDebugWorkflowPrompt(task) {
  const t = String(task || "").toLowerCase();
  return /\b(debug|bug|failing test|stack trace|exception|race condition|regression)\b/.test(t);
}

function buildDebugSubtasks(task) {
  const base = String(task || "").trim();
  return [
    `Debug stage 1/4: Reproduce and localize the issue from this report.\n\n${base}`,
    `Debug stage 2/4: Perform root-cause analysis.\n\n${base}`,
    `Debug stage 3/4: Propose a patch.\n\n${base}`,
    `Debug stage 4/4: Design regression checks for the proposed fix.\n\n${base}`,
  ];
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function run() {
  const debugPrompt = "Please debug failing test in parser and fix race condition";
  const nonDebugPrompt = "Write a hello world function in c";

  assert(isDebugWorkflowPrompt(debugPrompt), "debug prompt not detected");
  assert(!isDebugWorkflowPrompt(nonDebugPrompt), "non-debug prompt falsely detected");

  const subtasks = buildDebugSubtasks(debugPrompt);
  assert(subtasks.length === 4, "expected exactly 4 debug subtasks");
  assert(subtasks[0].includes("Reproduce"), "stage 1 mismatch");
  assert(subtasks[1].includes("root-cause"), "stage 2 mismatch");
  assert(subtasks[2].includes("patch"), "stage 3 mismatch");
  assert(subtasks[3].includes("regression"), "stage 4 mismatch");

  const result = {
    pass: true,
    checks: [
      "debug prompt detection",
      "non-debug prompt detection",
      "4-stage pipeline generation",
      "stage ordering validation",
    ],
    generated_at: new Date().toISOString(),
  };
  console.log(JSON.stringify(result, null, 2));
}

run();
