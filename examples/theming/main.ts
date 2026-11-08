import { configureEditorEnvironment, createEditorState, mountEditor, type ColorScheme } from "@openmarkdown-dev/editor";

// Start from the system setting; the button overrides it for this page.
const system = matchMedia("(prefers-color-scheme: dark)");
let scheme: ColorScheme = system.matches ? "dark" : "light";
const listeners = new Set<(s: ColorScheme) => void>();
const set = (next: ColorScheme) => {
  scheme = next;
  listeners.forEach((cb) => cb(next));
};
system.addEventListener("change", () => set(system.matches ? "dark" : "light"));

configureEditorEnvironment({
  colorScheme: {
    current: () => scheme,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  },
});

mountEditor(
  document.getElementById("editor")!,
  createEditorState({
    doc: "# A serif editor\n\nThe font, the [link colour](https://openmarkdown.dev) and the corners come from `--ome-*` tokens.\n\n> [!TIP]\n> Light and dark each have their own defaults. The button switches between them.\n",
  }),
);

const button = document.getElementById("scheme")!;
const label = () => (button.textContent = scheme === "dark" ? "Light" : "Dark");
listeners.add(label);
label();
button.addEventListener("click", () => set(scheme === "dark" ? "light" : "dark"));
