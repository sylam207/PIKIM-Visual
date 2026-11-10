# PKM Mindmap

Create and edit visual PKM mindmaps in Obsidian using WMM files, relationships, tags, notes, attachments, and reusable global parts.

## File access

The plugin reads and writes files inside the current Obsidian vault. The **Import mindmap file from computer** command also opens the operating system file picker so the user can explicitly select a `.wmm`, `.json`, or `.mind` file outside the vault. The plugin only reads the file the user selects.

## Network use

The plugin does not make automatic network requests and does not include client-side telemetry. The bundled runtime does not load remote fonts or other assets. User-provided web links or attachment URLs can be opened only when the user explicitly activates them; those links may connect to the destination selected by the user.

## Third-party software

This plugin bundles JSZip 3.10.1 by Stuart Knightley and contributors. JSZip is dual licensed under the MIT License or GPLv3; this distribution uses it under the MIT License. See `THIRD_PARTY_NOTICES.md`.

## License

Before submitting this plugin to the Obsidian Community directory, add a `LICENSE` file for the PKM Mindmap plugin itself and state that license here.
