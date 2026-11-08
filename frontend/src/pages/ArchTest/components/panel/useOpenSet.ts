import { useState } from "react";

export interface OpenSet {
  isOpen: (key: string) => boolean;
  setOpen: (key: string, open: boolean) => void;
}

export const useOpenSet = (): OpenSet => {
  const [open, setOpenKeys] = useState<ReadonlySet<string>>(new Set());
  return {
    isOpen: (key) => open.has(key),
    setOpen: (key, next) =>
      setOpenKeys((prev) => {
        if (prev.has(key) === next) return prev;
        const copy = new Set(prev);
        if (next) copy.add(key);
        else copy.delete(key);
        return copy;
      }),
  };
};

export const nextName = (prefix: string, existing: readonly string[]): string => {
  let counter = existing.length + 1;
  while (existing.includes(prefix + counter)) counter++;
  return prefix + counter;
};
