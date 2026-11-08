import { createEditorState, mountEditor } from "@openmarkdown-dev/editor";

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
`;

// Mermaid and the math renderer load the first time the document needs them.
mountEditor(document.getElementById("editor")!, createEditorState({ doc }));
