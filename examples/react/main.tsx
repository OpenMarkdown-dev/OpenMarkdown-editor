import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createEditorState, mountEditor, type MarkdownEditor } from "@openmarkdown-dev/editor";

const INITIAL = "# Notes\n\nThis editor lives in a React component.\nType here and watch the counter below.\n";

/** Mounts once, destroys on unmount; `value` from outside replaces the document. */
function Editor({ value, onChange }: { value: string; onChange: (doc: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const editor = useRef<MarkdownEditor | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    const ed = mountEditor(el.current!, createEditorState({ doc: value, host: { onChange: (doc) => latest.current(doc) } }));
    editor.current = ed;
    return () => {
      ed.destroy();
      editor.current = null;
    };
  }, []); // mount once; later values arrive through the effect below

  useEffect(() => {
    const ed = editor.current;
    if (ed && ed.getDoc() !== value) ed.setDoc(value);
  }, [value]);

  return <div ref={el} className="editor" />;
}

function App() {
  const [doc, setDoc] = useState(INITIAL);
  return (
    <>
      <Editor value={doc} onChange={setDoc} />
      <div className="bar">
        <button type="button" onClick={() => setDoc(INITIAL)}>Reset</button>
        <output id="count">{doc.length} characters</output>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
