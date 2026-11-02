/**
 * The CodeMirror editor. This module (and CodeMirror with it) is only reached through
 * `React.lazy` in JsonConfigEditor, so it lands in its own chunk and never in the main bundle.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter, lintGutter } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { isDarkScheme, qymTheme } from './codemirrorTheme';

export interface EditorHandle {
  focus: () => void;
}

export interface CodeMirrorEditorProps {
  value: string;
  onChange?: (text: string) => void;
  readOnly?: boolean;
  label: string;
  /** Lint the text as JSON (underline + gutter marker). Off for the read-only view. */
  lint?: boolean;
  onReady?: () => void;
}

const CodeMirrorEditor = forwardRef<EditorHandle, CodeMirrorEditorProps>(function CodeMirrorEditor(
  { value, onChange, readOnly, label, lint = true, onReady },
  ref,
) {
  const cm = useRef<ReactCodeMirrorRef>(null);
  useImperativeHandle(ref, () => ({ focus: () => cm.current?.view?.focus() }), []);
  useEffect(() => {
    onReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);
  const extensions = useMemo(
    () => [
      json(),
      ...(lint ? [linter(jsonParseLinter()), lintGutter()] : []),
      EditorView.lineWrapping,
      EditorView.perLineTextDirection.of(true),
      EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
      qymTheme(isDarkScheme()),
    ],
    [label, lint],
  );
  return (
    <CodeMirror
      ref={cm}
      value={value}
      onChange={onChange}
      theme="none"
      extensions={extensions}
      editable={!readOnly}
      readOnly={readOnly}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
        autocompletion: false,
        searchKeymap: true,
        dropCursor: false,
      }}
    />
  );
});

export default CodeMirrorEditor;
