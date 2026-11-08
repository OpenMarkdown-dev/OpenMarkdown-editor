# Image upload

Paste or drop an image and the editor hands its bytes to your `saveAttachment` callback, which stores them and returns the path to link. `resolveImage` maps that path back to a URL the page can load. Here the "upload" stays in the browser tab.
