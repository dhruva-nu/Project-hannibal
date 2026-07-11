import type { ReactNode } from "react";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import type { FeatureFlagKey } from "@/services/featureFlags";

interface FeatureGateProps {
  flag: FeatureFlagKey;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Renders `children` when `flag` is on for the current user, otherwise
 * `fallback` (nothing by default). Declarative alternative to sprinkling
 * `useFeatureFlag` ternaries through JSX.
 */
export const FeatureGate = ({ flag, children, fallback = null }: FeatureGateProps) => {
  return <>{useFeatureFlag(flag) ? children : fallback}</>;
};
