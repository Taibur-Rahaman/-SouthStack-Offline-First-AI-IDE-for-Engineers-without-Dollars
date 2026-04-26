/**
 * Self-repair control loop: observe → detect → classify → recover → validate with anti-oscillation guards.
 */

import type { GlobalTelemetrySnapshot } from "../../infra/observability/globalTelemetry";
import {
  decideSelfHealing,
  type HealthObservation,
  type SelfHealingDecision,
} from "../controlPlane/selfHealingController";
import { scoreDivergenceRisk } from "../consistency/crdtConvergenceGuardian";
import { forecastFailures, type RollingWindow } from "../prediction/failureForecastEngine";

export type Severity = "info" | "warn" | "critical";

export interface LoopContext {
  readonly tick: number;
  readonly cooldownTicksRemaining: number;
  readonly repairsInWindow: number;
}

export interface RepairOutcome {
  readonly severity: Severity;
  readonly decision: SelfHealingDecision;
  readonly divergenceRisk01: number;
  readonly preemptiveSignalsFired: boolean;
  readonly nextCooldownTicks: number;
  readonly nextRepairsInWindow: number;
  readonly stable: boolean;
}

const MAX_REPAIRS_PER_WINDOW = 3;
const COOLDOWN_AFTER_REPAIR = 4;
const WINDOW_LEN = 20;

export function classifySeverity(
  telemetry: GlobalTelemetrySnapshot,
  disconnectRate: number,
): Severity {
  if (telemetry.chunkReliability < 0.99 || disconnectRate > 0.08) return "critical";
  if (telemetry.yjsConvergenceP95Ms > 900 || disconnectRate > 0.03) return "warn";
  return "info";
}

export function runSelfRepairTick(
  ctx: LoopContext,
  obs: HealthObservation,
  rolling: RollingWindow,
): RepairOutcome {
  let repairsInWindow = ctx.repairsInWindow;
  if (ctx.tick % WINDOW_LEN === 0 && ctx.tick > 0) repairsInWindow = 0;

  const severity = classifySeverity(obs.telemetry, obs.recentDisconnectRate);
  const div = scoreDivergenceRisk({
    yjsLagP95Ms: obs.telemetry.yjsConvergenceP95Ms,
    awarenessLagP95Ms: obs.telemetry.awarenessPropagationP95Ms,
    chunkReliability: obs.telemetry.chunkReliability,
  });

  const forecast = forecastFailures(rolling);
  const preemptiveSignalsFired = Object.values(forecast.actions).some(Boolean);

  let decision = decideSelfHealing(obs, {});
  if (forecast.actions.shiftTurnPreference) {
    decision = {
      ...decision,
      rerouteTurnRegions: [...decision.rerouteTurnRegions].reverse(),
    };
  }

  const cooling = ctx.cooldownTicksRemaining > 0;
  const windowCap = repairsInWindow >= MAX_REPAIRS_PER_WINDOW;
  const needsRepair =
    severity !== "info" || div.score01 > 0.55 || preemptiveSignalsFired;
  const shouldRepair = !cooling && !windowCap && needsRepair;

  let nextCooldown =
    ctx.cooldownTicksRemaining > 0 ? ctx.cooldownTicksRemaining - 1 : 0;

  if (shouldRepair) {
    nextCooldown = COOLDOWN_AFTER_REPAIR;
    repairsInWindow = repairsInWindow + 1;
  }

  const stable =
    severity === "info" &&
    div.score01 < 0.35 &&
    !preemptiveSignalsFired &&
    !shouldRepair;

  return {
    severity,
    decision,
    divergenceRisk01: div.score01,
    preemptiveSignalsFired,
    nextCooldownTicks: nextCooldown,
    nextRepairsInWindow: repairsInWindow,
    stable,
  };
}
