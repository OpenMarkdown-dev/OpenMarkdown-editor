# Image upload

Paste or drop an image and the editor hands its bytes to your `uploadImage` callback, which stores them and returns the URL or path to link. The document needs no path, so this works for a CMS field or any text kept in a database. `resolveImage` maps the link back to a URL the page can load. Here the "upload" stays in the browser tab.

A document that does have a path can use `saveAttachment(docPath, bytes, hint)` instead, to store each image beside it.
