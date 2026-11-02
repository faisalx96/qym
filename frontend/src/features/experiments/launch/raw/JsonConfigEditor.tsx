import {
  Component,
  forwardRef,
  lazy,
  Suspense,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import type { EditorHandle } from './CodeMirrorEditor';
import styles from './raw.module.css';

// The editor is a separate chunk: CodeMirror must never be part of the main bundle.
const CodeMirrorEditor = lazy(() => import('./CodeMirrorEditor'));

export interface JsonConfigEditorProps {
  value: string;
  onChange?: (text: string) => void;
  readOnly?: boolean;
  /** Accessible name of the editor. */
  label: string;
  invalid?: boolean;
  lint?: boolean;
}

interface FallbackProps extends JsonConfigEditorProps {
  innerRef: React.RefObject<HTMLTextAreaElement>;
  /** Set when the textarea held focus as it went away (the editor chunk replaced it). */
  lostFocus: React.MutableRefObject<boolean>;
}

/** A plain textarea: shown while the editor chunk loads and when it fails to load. */
function PlainEditor({ value, onChange, readOnly, label, innerRef, lostFocus }: FallbackProps) {
  useLayoutEffect(() => {
    const el = innerRef.current;
    return () => {
      // Layout cleanups run before the node leaves the DOM: is the user typing in it?
      if (el && document.activeElement === el) lostFocus.current = true;
    };
  }, [innerRef, lostFocus]);
  return (
    <textarea
      ref={innerRef}
      className={styles.fallback}
      aria-label={label}
      value={value}
      readOnly={readOnly}
      spellCheck={false}
      dir="auto"
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
}

class ChunkBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * A JSON editor with a plain-textarea fallback. `focus()` goes into whichever editor is shown.
 * The text is data: the editor never evaluates it.
 */
export const JsonConfigEditor = forwardRef<EditorHandle, JsonConfigEditorProps>(
  function JsonConfigEditor(props, ref) {
    const cm = useRef<EditorHandle>(null);
    const plain = useRef<HTMLTextAreaElement>(null);
    const lostFocus = useRef(false);
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          if (cm.current) cm.current.focus();
          else plain.current?.focus();
        },
      }),
      [],
    );
    const fallback = <PlainEditor {...props} innerRef={plain} lostFocus={lostFocus} />;
    return (
      <div className={styles.editor} data-invalid={props.invalid ? '' : undefined} data-json-editor>
        <ChunkBoundary fallback={fallback}>
          <Suspense fallback={fallback}>
            <CodeMirrorEditor
              ref={cm}
              value={props.value}
              onChange={props.onChange}
              readOnly={props.readOnly}
              label={props.label}
              lint={props.lint}
              onReady={() => {
                // The textarea that had focus was swapped for the editor: keep the user where they were.
                if (lostFocus.current) {
                  lostFocus.current = false;
                  setTimeout(() => cm.current?.focus(), 0);
                }
              }}
            />
          </Suspense>
        </ChunkBoundary>
      </div>
    );
  },
);
