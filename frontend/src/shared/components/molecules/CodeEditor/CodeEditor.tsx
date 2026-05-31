import { useEffect, useRef } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { go } from "@codemirror/lang-go";
import { oneDark } from "@codemirror/theme-one-dark";
import { basicSetup } from "codemirror";
import { getFeatureCompletions } from "./completions";
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
          autocompletion({ override: [featureSource], activateOnTyping: true }),
          langCompartment.current.of(getLanguageExtension(language)),
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
      effects: langCompartment.current.reconfigure(getLanguageExtension(language)),
    });
  }, [language]);

  return <div ref={containerRef} className={styles.container} />;
};
