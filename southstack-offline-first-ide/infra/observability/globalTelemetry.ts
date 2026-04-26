/**
 * Global observability contracts: metrics taxonomy + aggregation sketches for dashboards.
 * Emits typed snapshots for Grafana/Datadog-style pipelines; does not instrument app code here.
 */

export interface HistogramBucket {
  readonly le: number;
  readonly count: number;
}

export interface QuantileSketch {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export interface PeerJoinMetric {
  readonly attempts: number;
  readonly successes: number;
  readonly failures: number;
}

export interface WebRtcLatencySeries {
  readonly samplesMs: readonly number[];
}

export interface TurnUsageMetric {
  readonly relayBytes: number;
  readonly hostBytes: number;
}

export interface ChunkTransferMetric {
  readonly chunksSent: number;
  readonly chunksAcked: number;
}

export interface YjsConvergenceMetric {
  readonly updateLagMs: readonly number[];
}

export interface AwarenessPropagationMetric {
  readonly awarenessLagMs: readonly number[];
}

export interface GlobalTelemetrySnapshot {
  readonly peerJoin: PeerJoinMetric;
  readonly webrtcLatency: QuantileSketch;
  readonly turnUsageRatio: number;
  readonly chunkReliability: number;
  readonly yjsConvergenceP95Ms: number;
  readonly awarenessPropagationP95Ms: number;
  readonly emittedAtIso: string;
}

function quantiles(sorted: readonly number[]): QuantileSketch {
  if (sorted.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  return { p50: q(0.5), p95: q(0.95), p99: q(0.99) };
}

export function summarizeWebRtcLatency(series: WebRtcLatencySeries): QuantileSketch {
  const sorted = [...series.samplesMs].sort((a, b) => a - b);
  return quantiles(sorted);
}

export function computeTurnUsageRatio(m: TurnUsageMetric): number {
  const total = m.relayBytes + m.hostBytes;
  if (total === 0) return 0;
  return m.relayBytes / total;
}

export function computeChunkReliability(m: ChunkTransferMetric): number {
  if (m.chunksSent === 0) return 1;
  return Math.min(1, m.chunksAcked / m.chunksSent);
}

export function p95(ms: readonly number[]): number {
  if (ms.length === 0) return 0;
  const sorted = [...ms].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)));
  return sorted[idx];
}

/**
 * Aggregate raw counters into the snapshot shape operators export to dashboards.
 */
export function buildTelemetrySnapshot(input: {
  peerJoin: PeerJoinMetric;
  webrtcLatency: WebRtcLatencySeries;
  turnUsage: TurnUsageMetric;
  chunks: ChunkTransferMetric;
  yjsLag: YjsConvergenceMetric;
  awarenessLag: AwarenessPropagationMetric;
}): GlobalTelemetrySnapshot {
  const webrtcLatency = summarizeWebRtcLatency(input.webrtcLatency);
  return {
    peerJoin: input.peerJoin,
    webrtcLatency,
    turnUsageRatio: computeTurnUsageRatio(input.turnUsage),
    chunkReliability: computeChunkReliability(input.chunks),
    yjsConvergenceP95Ms: p95(input.yjsLag.updateLagMs),
    awarenessPropagationP95Ms: p95(input.awarenessLag.awarenessLagMs),
    emittedAtIso: new Date().toISOString(),
  };
}

/** Streaming sink interface for real-time exporters (Kafka, OTLP, etc.). */
export interface TelemetryStreamSink {
  push(snapshot: GlobalTelemetrySnapshot): void;
}

export class InMemoryTelemetryRingBuffer implements TelemetryStreamSink {
  private readonly buf: GlobalTelemetrySnapshot[] = [];
  constructor(private readonly max = 500) {}
  push(snapshot: GlobalTelemetrySnapshot): void {
    this.buf.push(snapshot);
    if (this.buf.length > this.max) this.buf.shift();
  }
  snapshot(): readonly GlobalTelemetrySnapshot[] {
    return [...this.buf];
  }
}
