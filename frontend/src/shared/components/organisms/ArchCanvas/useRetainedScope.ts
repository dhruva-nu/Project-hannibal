import { useEffect, useState } from "react";
import type { LayerId, View } from "@/pages/ArchTest/engine";

export const CLOSE_MS = 600;

interface Shown {
  scope: LayerId | null;
  view: View;
  closing: boolean;
}

/**
 * Keeps the last open layer rendered while its window shrinks back, so collapsing can animate instead of vanishing.
 * The closing layer is derived during render (not in an effect) so there is never a committed frame without it.
 */
export const useRetainedScope = (scope: LayerId | null, view: View, viewOfScope: (scope: LayerId) => View): Shown => {
  const [previousScope, setPreviousScope] = useState<LayerId | null>(scope);
  const [closingScope, setClosingScope] = useState<LayerId | null>(null);

  if (scope !== previousScope) {
    setPreviousScope(scope);
    setClosingScope(scope ? null : previousScope);
  }

  useEffect(() => {
    if (!closingScope) return;
    const timer = setTimeout(() => setClosingScope(null), CLOSE_MS);
    return () => clearTimeout(timer);
  }, [closingScope]);

  if (scope) return { scope, view, closing: false };
  if (closingScope) return { scope: closingScope, view: viewOfScope(closingScope), closing: true };
  return { scope: null, view, closing: false };
};
