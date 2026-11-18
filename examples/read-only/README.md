# Reading mode

Open a document read-only in reading mode, then switch to live preview or plain source with `setMode`. The document, selection and undo history stay as they were.

Reading mode still lets the reader tick a task checkbox. To forbid every change in every mode, create the state with `editable: false`, or call `editor.setEditable(false)`, as the "Locked" switch does.
