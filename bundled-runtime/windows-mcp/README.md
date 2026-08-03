# Windows desktop runtime

Leemo ships the single-file Windows MCP runtime from
[`sbroenne/mcp-windows`](https://github.com/sbroenne/mcp-windows) so desktop
operation works offline after installation. The release manifest fixes the
source version, archive hash, executable hash, and size.

The executable is copied to Electron `extraResources` rather than ASAR because
Windows must launch it as a native process. Keep the three release files
together. `npm run verify:computer-runtime` must pass before packaging.
