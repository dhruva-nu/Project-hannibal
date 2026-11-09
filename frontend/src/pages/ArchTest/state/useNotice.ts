import { useEffect, useState } from "react";
import type { Notice } from "./archApi";

const NOTICE_DURATION_MS = 4500;

export const useNotice = () => {
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return { notice, notify: setNotice, dismissNotice: () => setNotice(null) };
};
