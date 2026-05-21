import { useEffect, useLayoutEffect, useRef } from "react";

const OPEN_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const CLOSE_EASING = "cubic-bezier(0.55, 0, 0.85, 0.5)";

export function useModalFlip(originRect: DOMRect, onClose: () => void) {
  const modalRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);

  useLayoutEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    const mr = modal.getBoundingClientRect();
    const dx = (originRect.left + originRect.width / 2) - (mr.left + mr.width / 2);
    const dy = (originRect.top + originRect.height / 2) - (mr.top + mr.height / 2);
    const sx = originRect.width / mr.width;
    const sy = originRect.height / mr.height;
    modal.style.transition = "none";
    modal.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    modal.style.opacity = "0.6";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      modal.style.transition = `transform 0.46s ${OPEN_EASING}, opacity 0.24s ease`;
      modal.style.transform = "";
      modal.style.opacity = "";
    }));
  }, [originRect]);

  const handleClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const modal = modalRef.current;
    const backdrop = backdropRef.current;
    if (!modal) { onClose(); return; }
    const mr = modal.getBoundingClientRect();
    const dx = (originRect.left + originRect.width / 2) - (mr.left + mr.width / 2);
    const dy = (originRect.top + originRect.height / 2) - (mr.top + mr.height / 2);
    const sx = originRect.width / mr.width;
    const sy = originRect.height / mr.height;
    modal.style.transition = `transform 0.36s ${CLOSE_EASING}, opacity 0.28s ease`;
    modal.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    modal.style.opacity = "0";
    if (backdrop) { backdrop.style.transition = "opacity 0.34s ease"; backdrop.style.opacity = "0"; }
    setTimeout(onClose, 360);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, []);

  return { modalRef, backdropRef, handleClose };
}
