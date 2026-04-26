/**
 * Lightweight predictive signals from rolling telemetry — preemptive routing hints only.
 */

export interface RollingWindow {
  readonly turnUsageTrend: number;
  readonly signalingLatencyTrend: number;
  readonly peerChurnTrend: number;
  readonly chunkFailureTrend: number;
}

export interface PreemptiveAction {
  readonly widenIceCandidatePool: boolean;
  readonly shiftTurnPreference: boolean;
  readonly triggerEarlyMeshRebuild: boolean;
  readonly proactiveReconnectSignaling: boolean;
}

export interface ForecastResult {
  readonly turnOverloadRisk01: number;
  readonly signalingSpikeRisk01: number;
  readonly peerChurnRisk01: number;
  readonly chunkFailureRisk01: number;
  readonly actions: PreemptiveAction;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function forecastFailures(window: RollingWindow): ForecastResult {
  const turnOverloadRisk01 = clamp01(window.turnUsageTrend * 1.2);
  const signalingSpikeRisk01 = clamp01(window.signalingLatencyTrend / 1000);
  const peerChurnRisk01 = clamp01(window.peerChurnTrend);
  const chunkFailureRisk01 = clamp01(window.chunkFailureTrend * 5);

  const actions: PreemptiveAction = {
    widenIceCandidatePool: turnOverloadRisk01 > 0.55 || signalingSpikeRisk01 > 0.5,
    shiftTurnPreference: turnOverloadRisk01 > 0.45,
    triggerEarlyMeshRebuild: peerChurnRisk01 > 0.4 || chunkFailureRisk01 > 0.35,
    proactiveReconnectSignaling: signalingSpikeRisk01 > 0.55,
  };

  return {
    turnOverloadRisk01,
    signalingSpikeRisk01,
    peerChurnRisk01,
    chunkFailureRisk01,
    actions,
  };
}
