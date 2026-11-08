# Save and load

Read a file's bytes with `openMarkdownFile`, give the editor its text, and write it back with `saveMarkdownFile`, which keeps the file's BOM and line endings. The page compares what Save would write with what was opened, byte by byte: open a file and save it without editing, and it is the same bytes. A file that is not valid UTF-8 is refused instead of opened.
