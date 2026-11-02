/**
 * Pure admission guard shared by the subscription scheduler and Gateway
 * integration. It deliberately knows nothing about HTTP requests or tokens:
 * the Gateway can only ask whether an exhausted subscription is eligible for
 * one local, serialized reset operation.
 */
export interface ResetGatewayAdmissionInput {
  subscriptionAccount: boolean;
  weeklyExhausted: boolean;
  poolEnabled: boolean;
  viableFallback: boolean;
  failureStatus?: number;
  failureReason?: string;
  alreadyRetried: boolean;
}

export interface ResetGatewayAdmissionDecision {
  allowed: boolean;
  reason: "not-subscription" | "not-exhausted" | "fallback-available" | "generic-rate-limit" | "already-retried" | "eligible";
}

export function decideResetGatewayAdmission(input: ResetGatewayAdmissionInput): ResetGatewayAdmissionDecision {
  if (!input.subscriptionAccount) return { allowed: false, reason: "not-subscription" };
  if (!input.poolEnabled || !input.weeklyExhausted) return { allowed: false, reason: "not-exhausted" };
  if (input.viableFallback) return { allowed: false, reason: "fallback-available" };
  if (input.failureStatus === 429 || input.failureReason === "rate_limited" || input.failureReason === "generic_429") {
    return { allowed: false, reason: "generic-rate-limit" };
  }
  if (input.alreadyRetried) return { allowed: false, reason: "already-retried" };
  return { allowed: true, reason: "eligible" };
}
