import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** CSS height, e.g. "20rem". */
  height?: string;
  /** Called with Ctrl/Cmd+Enter. */
  onRun?: () => void;
  ariaLabel?: string;
}

/**
 * Python code editor (CodeMirror 6): line numbers, syntax highlighting,
 * auto-indent, bracket matching, Tab to indent and Ctrl/Cmd+Enter to run.
 */
export default function CodeEditor({ value, onChange, height = '20rem', onRun, ariaLabel = 'Python code editor' }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Keep the latest callbacks without recreating the editor.
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          indentUnit.of('    '),
          EditorState.tabSize.of(4),
          python(),
          oneDark,
          keymap.of([
            { key: 'Mod-Enter', run: () => { onRunRef.current?.(); return true; } },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          EditorView.theme({
            '&': { height, fontSize: '14px', borderRadius: '0.5rem' },
            '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', overflow: 'auto' },
            '&.cm-focused': { outline: 'none' },
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // The editor is created once; later value changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync changes made outside the editor (loading a session, restoring code).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div ref={hostRef} className="rounded-lg overflow-hidden border border-slate-800 focus-within:ring-2 focus-within:ring-violet-500/60" />;
}
