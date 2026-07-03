import { useEffect, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { LanguageSupport } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { go } from "@codemirror/lang-go";
import { oneDark } from "@codemirror/theme-one-dark";
import { basicSetup } from "codemirror";
import { getFeatureCompletions } from "./completions";
import { importCompletionSource, packageIntelligence } from "./importLinting";
import styles from "./CodeEditor.module.css";

function featureSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\w+\.\w*/);
  if (!match) return null;
  const [trigger] = match.text.split(".");
  const options = getFeatureCompletions(trigger);
  if (!options) return null;
  return { from: match.from + trigger.length + 1, options };
}

function getLanguageExtension(lang: string) {
  switch (lang) {
    case "javascript": return javascript();
    case "python": return python();
    case "go": return go();
    default: return [];
  }
}

// Languages the backend package index + registry check support.
const PACKAGE_LANGS = new Set(["python", "javascript"]);

// Everything that depends on the current language: syntax, import-aware
// autocomplete, and (where supported) the package existence spinner + linter.
function languageBundle(lang: string): Extension {
  const support = getLanguageExtension(lang);
  const extras: Extension[] = [];

  // Register our completion sources as language DATA so they merge with the
  // language's built-in keyword/snippet completions (if, def, …). Using
  // `override` instead would replace those built-ins entirely.
  if (support instanceof LanguageSupport) {
    extras.push(support.language.data.of({ autocomplete: featureSource }));
    if (PACKAGE_LANGS.has(lang)) {
      extras.push(
        support.language.data.of({ autocomplete: importCompletionSource(lang) }),
      );
    }
  }
  if (PACKAGE_LANGS.has(lang)) extras.push(...packageIntelligence(lang));

  return [support, autocompletion({ activateOnTyping: true }), ...extras];
}

interface CodeEditorProps {
  value: string;
  language: string;
  onChange: (code: string) => void;
}

export const CodeEditor = ({ value, language, onChange }: CodeEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          langCompartment.current.of(languageBundle(language)),
          oneDark,
          EditorView.updateListener.of(update => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          EditorView.theme({
            "&": { height: "100%", fontSize: "12.5px" },
            ".cm-scroller": { fontFamily: "var(--font-mono)", overflow: "auto" },
            ".cm-editor": { height: "100%" },
            ".cm-focused": { outline: "none" },
          }),
        ],
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: langCompartment.current.reconfigure(languageBundle(language)),
    });
  }, [language]);

  return <div ref={containerRef} className={styles.container} />;
};
