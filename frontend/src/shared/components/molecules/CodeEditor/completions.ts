import type { Completion } from "@codemirror/autocomplete";

export interface FeatureCompletion {
  trigger: string;
  methods: Completion[];
}

const modules = import.meta.glob<{ default: FeatureCompletion }>(
  "./completions/*.ts",
  { eager: true },
);

const registry = new Map<string, FeatureCompletion>(
  Object.values(modules).map(m => [m.default.trigger, m.default]),
);

export function getFeatureCompletions(trigger: string): Completion[] | null {
  return registry.get(trigger)?.methods ?? null;
}
