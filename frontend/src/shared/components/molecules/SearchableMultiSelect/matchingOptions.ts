export const matchingOptions = (options: readonly string[], search: string): string[] => {
  const needle = search.trim().toLowerCase();
  return options.filter((o) => o.toLowerCase().includes(needle));
};
