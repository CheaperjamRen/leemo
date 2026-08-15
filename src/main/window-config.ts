/**
 * Minimum usable desktop size for the workbench layout.
 *
 * Keep this Electron-independent so packaging and renderer-layout checks can
 * assert the product constraint without starting the main process.
 */
export const MAIN_WINDOW_OPTIONS = Object.freeze({
  width: 1280,
  height: 860,
  minWidth: 960,
  minHeight: 680,
  autoHideMenuBar: true,
  frame: false,
});

/** Compact enough to feel instant, large enough for a multiline note and its
 * restrained formatting toolbar. It is created hidden and shown only after an
 * explicit shortcut or tray action. */
export const QUICK_CAPTURE_WINDOW_OPTIONS = Object.freeze({
  width: 520,
  height: 420,
  minWidth: 400,
  minHeight: 300,
  show: false,
  autoHideMenuBar: true,
  frame: false,
});
