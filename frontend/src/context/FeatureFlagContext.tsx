import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { getFeatureFlags, type FeatureFlagKey, type FeatureFlagMap } from "@/services/featureFlags";

interface FeatureFlagContextValue {
  flags: FeatureFlagMap;
  loading: boolean;
  isEnabled: (key: FeatureFlagKey) => boolean;
}

const FeatureFlagContext = createContext<FeatureFlagContextValue | null>(null);

export const FeatureFlagProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [fetched, setFetched] = useState<FeatureFlagMap>({});
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    // Flags are user-dependent, so re-resolve whenever the signed-in user
    // changes. Logged-out users are handled by the derived values below, so
    // the effect only ever touches state from async callbacks.
    if (!user) return;
    let cancelled = false;
    getFeatureFlags()
      .then((data) => { if (!cancelled) setFetched(data); })
      .catch(() => { if (!cancelled) setFetched({}); /* fail closed */ })
      .finally(() => { if (!cancelled) setFetching(false); });
    return () => { cancelled = true; };
  }, [user]);

  // A logged-out user has no flags and nothing to wait for.
  const flags = user ? fetched : {};
  const loading = user ? fetching : false;

  const isEnabled = (key: FeatureFlagKey) => flags[key] === true;

  return (
    <FeatureFlagContext.Provider value={{ flags, loading, isEnabled }}>
      {children}
    </FeatureFlagContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useFeatureFlags = (): FeatureFlagContextValue => {
  const ctx = useContext(FeatureFlagContext);
  if (!ctx) throw new Error("useFeatureFlags must be used inside FeatureFlagProvider");
  return ctx;
};
