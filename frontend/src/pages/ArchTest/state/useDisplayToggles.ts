import { useState } from "react";

export const useDisplayToggles = () => {
  const [showFlow, setShowFlow] = useState(false);
  const [showStateLinks, setShowStateLinks] = useState(false);
  const [showStore, setShowStore] = useState(true);
  return {
    showFlow,
    showStateLinks,
    showStore,
    toggleFlow: () => setShowFlow((shown) => !shown),
    toggleStateLinks: () => setShowStateLinks((shown) => !shown),
    toggleStore: () => setShowStore((shown) => !shown),
  };
};
