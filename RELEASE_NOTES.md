# Community-directory review changes

- Bundled the runtime into release `main.js`, because the Community directory installs only `main.js`, `manifest.json`, and optional `styles.css` from a release.
- Removed the Google Fonts network import and switched the embedded editor to system fonts.
- Removed `:has()` selectors and `!important` from the embedded CSS.
- Improved HTML accessibility and removed the inline `style` attribute from the hidden file input.
- Kept JSZip 3.10.1 unchanged and preserved its upstream license header.
- Routed embedded confirmation dialogs through an Obsidian `Modal` and removed iframe `allow-modals`.
- Added host `styles.css` using Obsidian CSS variables.
- Disabled automatic Gist network requests in the embedded runtime; the plugin now operates offline unless the user explicitly opens a user-provided link.
- A plugin-level `LICENSE` is still required before Community directory submission.
