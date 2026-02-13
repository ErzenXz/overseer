import { createLogger } from "@/lib/logger";

// Keep this extensible: new channels can be added without touching this file.
export type ChannelType = string;

interface ChannelState {
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  lastFailureAt?: string;
  lastSuccessAt?: string;
  lastAlertAt?: number;
}

interface ChannelEventInput {
  channel: ChannelType;
  event:
    | "startup"
    | "health_check"
    | "message_processing"
    | "command_processing"
    | "runtime_error"
    | "rate_limit";
  ok: boolean;
  details?: Record<string, unknown>;
}

const logger = createLogger("channel-observability");

const channelStates: Record<string, ChannelState> = {};

function getOrCreateChannelState(channel: string): ChannelState {
  if (!channelStates[channel]) {
    channelStates[channel] = {
      consecutiveFailures: 0,
      totalFailures: 0,
      totalSuccesses: 0,
    };
  }
  return channelStates[channel];
}

function getFailureAlertThreshold(): number {
  const fromEnv = Number.parseInt(
    process.env.CHANNEL_FAILURE_ALERT_THRESHOLD || "3",
    10,
  );

  if (!Number.isFinite(fromEnv) || fromEnv < 1) return 3;
  return fromEnv;
}

function getAlertCooldownMs(): number {
  const fromEnv = Number.parseInt(
    process.env.CHANNEL_ALERT_COOLDOWN_MS || "300000",
    10,
  );

  if (!Number.isFinite(fromEnv) || fromEnv < 0) return 300_000;
  return fromEnv;
}

export function recordChannelEvent(input: ChannelEventInput): void {
  const nowIso = new Date().toISOString();
  const state = getOrCreateChannelState(input.channel);

  if (input.ok) {
    state.consecutiveFailures = 0;
    state.totalSuccesses += 1;
    state.lastSuccessAt = nowIso;

    logger.info("Channel event success", {
      channel: input.channel,
      event: input.event,
      status: "ok",
      consecutiveFailures: state.consecutiveFailures,
      totalSuccesses: state.totalSuccesses,
      ...input.details,
    });

    return;
  }

  state.consecutiveFailures += 1;
  state.totalFailures += 1;
  state.lastFailureAt = nowIso;

  logger.warn("Channel event failure", {
    channel: input.channel,
    event: input.event,
    status: "failed",
    consecutiveFailures: state.consecutiveFailures,
    totalFailures: state.totalFailures,
    ...input.details,
  });

  const threshold = getFailureAlertThreshold();
  const cooldownMs = getAlertCooldownMs();
  const now = Date.now();
  const inCooldown =
    typeof state.lastAlertAt === "number" &&
    now - state.lastAlertAt < cooldownMs;

  if (state.consecutiveFailures >= threshold && !inCooldown) {
    state.lastAlertAt = now;

    logger.error("Channel reliability alert threshold reached", {
      alertType: "CHANNEL_FAILURE_STREAK",
      channel: input.channel,
      threshold,
      cooldownMs,
      consecutiveFailures: state.consecutiveFailures,
      totalFailures: state.totalFailures,
      lastSuccessAt: state.lastSuccessAt,
      lastFailureAt: state.lastFailureAt,
      triggeringEvent: input.event,
      ...input.details,
    });
  }
}

export function getChannelObservabilitySnapshot(
  channel: ChannelType,
): ChannelState {
  return { ...channelStates[channel] };
}
