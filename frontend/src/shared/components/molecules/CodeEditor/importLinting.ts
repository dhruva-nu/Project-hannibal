/**
 * Editor package intelligence: autocomplete imports from the cache, verify
 * unknown ones against the registry (spinner while pending), and red-squiggle
 * the ones that don't exist.
 */
import type {
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { linter, forceLinting, type Diagnostic } from "@codemirror/lint";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import { searchPackages, verifyPackage } from "@/services/packages";
import { importCompletionSpot, listImportedPackages } from "./imports";
import styles from "./CodeEditor.module.css";

type PackageStatus = "pending" | "ok" | "missing";

const setStatus = StateEffect.define<{ name: string; status: PackageStatus }>();

const statusField = StateField.define<Map<string, PackageStatus>>({
  create: () => new Map(),
  update(statuses, tr) {
    let next = statuses;
    for (const effect of tr.effects) {
      if (effect.is(setStatus)) {
        next = new Map(next);
        next.set(effect.value.name, effect.value.status);
      }
    }
    return next;
  },
});

/** Autocomplete source that suggests cached packages while typing an import. */
export function importCompletionSource(language: string): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const before = context.state.sliceDoc(0, context.pos);
    const spot = importCompletionSpot(before, language);
    if (!spot) return null;
    if (!context.explicit && spot.prefix.length === 0) return null;

    const names = await searchPackages(language, spot.prefix);
    if (names.length === 0) return null;
    return {
      from: spot.from,
      options: names.map((name) => ({ label: name, type: "namespace" })),
      validFor: /^[\w@/.-]*$/,
    };
  };
}

class SpinnerWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = styles.pkgSpinner;
    span.setAttribute("aria-label", "checking package");
    return span;
  }
  eq(): boolean {
    return true;
  }
}

const VERIFY_DELAY_MS = 400;

/** Debounced verification driver + the pending spinner decorations. */
function verificationPlugin(language: string) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private timer: ReturnType<typeof setTimeout> | undefined;

      constructor(view: EditorView) {
        this.decorations = buildSpinners(view, language);
        this.schedule(view);
      }

      update(update: ViewUpdate) {
        this.decorations = buildSpinners(update.view, language);
        if (update.docChanged) this.schedule(update.view);
      }

      private schedule(view: EditorView) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.verify(view), VERIFY_DELAY_MS);
      }

      private verify(view: EditorView) {
        const statuses = view.state.field(statusField);
        const names = new Set(
          listImportedPackages(view.state.doc.toString(), language).map((p) => p.name),
        );
        for (const name of names) {
          if (statuses.has(name)) continue;
          view.dispatch({ effects: setStatus.of({ name, status: "pending" }) });
          verifyPackage(language, name)
            .then((result) => {
              // Only a definite "does not exist" earns a squiggle; null (registry
              // unreachable) and true are both treated as fine.
              const status: PackageStatus = result.exists === false ? "missing" : "ok";
              view.dispatch({ effects: setStatus.of({ name, status }) });
              forceLinting(view);
            })
            .catch(() => {
              view.dispatch({ effects: setStatus.of({ name, status: "ok" }) });
            });
        }
      }

      destroy() {
        clearTimeout(this.timer);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

function buildSpinners(view: EditorView, language: string): DecorationSet {
  const statuses = view.state.field(statusField);
  const packages = listImportedPackages(view.state.doc.toString(), language);
  const marks = packages
    .filter((pkg) => statuses.get(pkg.name) === "pending")
    .map((pkg) =>
      Decoration.widget({ widget: new SpinnerWidget(), side: 1 }).range(pkg.to),
    );
  return Decoration.set(marks, true);
}

function importLinter(language: string): Extension {
  return linter(
    (view) => {
      const statuses = view.state.field(statusField);
      const diagnostics: Diagnostic[] = [];
      for (const pkg of listImportedPackages(view.state.doc.toString(), language)) {
        if (statuses.get(pkg.name) === "missing") {
          diagnostics.push({
            from: pkg.from,
            to: pkg.to,
            severity: "error",
            message: `Package "${pkg.name}" was not found on the registry.`,
          });
        }
      }
      return diagnostics;
    },
    {
      delay: 200,
      // A verdict arrives asynchronously as a setStatus effect, not a doc edit —
      // without this the squiggle wouldn't appear until the next keystroke.
      needsRefresh: (update) =>
        update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(setStatus)),
        ),
    },
  );
}

/** The full package-intelligence bundle for one language. */
export function packageIntelligence(language: string): Extension[] {
  return [statusField, verificationPlugin(language), importLinter(language)];
}
