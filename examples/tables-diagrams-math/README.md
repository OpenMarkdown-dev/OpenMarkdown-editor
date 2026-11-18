# Tables, diagrams and math

Tables you edit cell by cell where they sit, Mermaid diagrams and LaTeX math rendered in place. The diagram and math renderers load only when a document first needs them.

Fenced code is highlighted because this example opts in: it installs `@codemirror/language-data` and passes its `languages` as `codeLanguages`. Each language's grammar loads the first time a code block uses it. Without the option, code blocks show unhighlighted and the package never pulls in the language list.
