import { createEditorState, mountEditor } from "@openmarkdown-dev/editor";
// Optional: highlighted code blocks in ~100 languages. Install it beside the editor.
import { languages } from "@codemirror/language-data";

const doc = `# Tables, diagrams and math

Click into a cell and type; Tab moves to the next one.

| Planet | Moons | Rings |
| :--- | ---: | :---: |
| Earth | 1 | no |
| Saturn | 274 | yes |

Inline math like $e^{i\\pi} + 1 = 0$, and a block:

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$

\`\`\`mermaid
graph LR
  A[Markdown text] --> B[Editor]
  B --> C[Same text, saved]
\`\`\`

\`\`\`ts
const answer: number = 42; // highlighted: a language from codeLanguages
\`\`\`
`;

// Mermaid, the math renderer and each code language load the first time the
// document needs them.
mountEditor(document.getElementById("editor")!, createEditorState({ doc, codeLanguages: languages }));
