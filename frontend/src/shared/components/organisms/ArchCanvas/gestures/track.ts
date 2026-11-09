/** Follow a pointer across the whole window until it is released or cancelled. */
export const trackPointer = (onMove: (event: PointerEvent) => void, onEnd: (event: PointerEvent) => void): void => {
  const finish = (event: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    onEnd(event);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
};
