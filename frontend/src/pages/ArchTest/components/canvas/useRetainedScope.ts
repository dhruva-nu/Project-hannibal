import { useEffect, useRef, useState } from "react";
import type { LayerId, View } from "../../engine";

export const CLOSE_MS = 600;

interface Shown {
  scope: LayerId | null;
  view: View;
  closing: boolean;
}

interface Retained {
  scope: LayerId;
  view: View;
}

/**
 * Keeps the last open layer rendered while its window shrinks back, so collapsing can animate instead of vanishing.
 * The retained layer is set during render (not in an effect) so there is never a committed frame without it.
 */
export const useRetainedScope = (scope: LayerId | null, view: View): Shown => {
  const [retained, setRetained] = useState<Retained | null>(null);
  const last = useRef<Retained | null>(null);
  if (scope) last.current = { scope, view };
  if (scope && retained) setRetained(null);
  if (!scope && !retained && last.current) setRetained(last.current);

  useEffect(() => {
    if (!retained) return;
    const timer = setTimeout(() => {
      last.current = null;
      setRetained(null);
    }, CLOSE_MS);
    return () => clearTimeout(timer);
  }, [retained]);

  if (scope) return { scope, view, closing: false };
  return retained ? { ...retained, closing: true } : { scope: null, view, closing: false };
};
