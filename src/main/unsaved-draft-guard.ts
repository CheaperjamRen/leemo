interface PreventableUnloadEvent {
  preventDefault(): void;
}

interface UnloadAwareWebContents {
  on(
    event: "will-prevent-unload",
    listener: (event: PreventableUnloadEvent) => void,
  ): unknown;
}

/**
 * Electron reverses the usual DOM meaning here: preventing the
 * `will-prevent-unload` event tells Electron to ignore the renderer veto and
 * continue closing. Keep that detail in one named boundary so callers cannot
 * accidentally invert the user's choice.
 */
export function attachUnsavedDraftGuard(
  webContents: UnloadAwareWebContents,
  confirmDiscard: () => boolean,
): void {
  webContents.on("will-prevent-unload", (event) => {
    if (confirmDiscard()) event.preventDefault();
  });
}
