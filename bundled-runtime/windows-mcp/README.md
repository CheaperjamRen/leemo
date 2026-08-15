# Windows desktop runtime

Leemo ships the single-file Windows MCP runtime from
[`sbroenne/mcp-windows`](https://github.com/sbroenne/mcp-windows) so desktop
operation works offline after installation. The release manifest fixes the
source version, archive hash, executable hash, size, and local compatibility
patches.

The upstream 1.3.18 single-file executable starts as DPI-unaware even though its
project configuration requests per-monitor awareness. At Windows display scales
above 100%, that mixes logical window bounds with physical screenshot pixels and
crops window captures to the upper-left area. Leemo embeds the explicit
[`dpi-awareness.manifest`](./dpi-awareness.manifest) resource after importing a
new upstream executable:

```bash
npm run patch:computer-runtime
```

The patcher preserves the exact single-file byte length so the appended .NET
payload is not truncated. It is idempotent and refreshes the release hash and
patch metadata.

The executable is copied to Electron `extraResources` rather than ASAR because
Windows must launch it as a native process. Keep the three release files
together. `npm run verify:computer-runtime` must pass before packaging.
