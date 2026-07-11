import { api } from "./api";

/**
 * The set of flag keys the frontend knows about. Adding a key here is what
 * makes `useFeatureFlag("...")` type-check — the DB stays the source of truth
 * for a flag's *state*, this union for what the code is allowed to reference.
 */
export type FeatureFlagKey = "new-lesson-sidebar" | "copilot-v2";

export type FeatureFlagMap = Partial<Record<FeatureFlagKey, boolean>>;

interface EvaluationResponse {
  flags: Record<string, boolean>;
}

export async function getFeatureFlags(): Promise<FeatureFlagMap> {
  const { flags } = await api.get<EvaluationResponse>("/api/v1/feature-flags/");
  return flags;
}
