import { useFeatureFlags } from "@/context/FeatureFlagContext";
import type { FeatureFlagKey } from "@/services/featureFlags";

/**
 * Returns whether a single flag is on for the current user. Fails closed:
 * unknown keys, in-flight fetches, and fetch errors all read `false`.
 */
export const useFeatureFlag = (key: FeatureFlagKey): boolean => {
  return useFeatureFlags().isEnabled(key);
};
