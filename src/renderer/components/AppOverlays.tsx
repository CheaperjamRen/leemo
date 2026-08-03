import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useUi, useWikiEntries } from "../bridge/context";
import GlobalSearchPage from "../pages/GlobalSearchPage";
import { SettingsPage } from "../pages/SettingsPage";
import { NotificationPanel } from "./NotificationPanel";
import WikiPopup from "./WikiPopup";

/** Shared, app-level surfaces. Both shells operate on the same stores and must
 * expose the same settings/search/notification behavior without duplicating
 * overlay wiring inside each shell. */
export default function AppOverlays() {
  const settingsOpen = useUi((s) => s.settingsOpen);
  const searchOpen = useUi((s) => s.searchOpen);
  const notifPanelOpen = useUi((s) => s.notifPanelOpen);
  const closeTopOverlay = useUi((s) => s.closeTopOverlay);
  const wikiActive = useWikiEntries((s) => s.active);
  const closeWiki = useWikiEntries((s) => s.closePopup);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [confirmSettingsClose, setConfirmSettingsClose] = useState(false);

  const requestSettingsClose = useCallback(() => {
    if (settingsBusy) return;
    if (settingsDirty) setConfirmSettingsClose(true);
    else closeTopOverlay();
  }, [closeTopOverlay, settingsBusy, settingsDirty]);

  const discardAndCloseSettings = useCallback(() => {
    setConfirmSettingsClose(false);
    setSettingsDirty(false);
    closeTopOverlay();
  }, [closeTopOverlay]);

  useEffect(() => {
    if (settingsOpen) return;
    setSettingsDirty(false);
    setSettingsBusy(false);
    setConfirmSettingsClose(false);
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsOpen && !searchOpen && !notifPanelOpen && !wikiActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (settingsOpen) requestSettingsClose();
      else if (searchOpen || notifPanelOpen) closeTopOverlay();
      else closeWiki();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeTopOverlay, closeWiki, notifPanelOpen, requestSettingsClose, searchOpen, settingsOpen, wikiActive]);

  return (
    <>
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#17191c]/30 p-4 backdrop-blur-[1px] sm:p-6"
          data-testid="settings-overlay"
          data-shell="workbench"
          role="dialog"
          aria-modal="true"
          aria-label="设置"
          onClick={requestSettingsClose}
        >
          <div
            className="relative flex h-[min(720px,calc(100vh-32px))] w-[min(1040px,calc(100vw-32px))] flex-col overflow-hidden rounded-[8px] border border-[var(--leemo-line)] bg-white shadow-[0_24px_70px_-26px_rgba(24,31,38,0.48)] sm:h-[min(720px,calc(100vh-48px))] sm:w-[min(1040px,calc(100vw-48px))]"
            data-testid="settings-window"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              onClick={requestSettingsClose}
              disabled={settingsBusy}
              className="leemo-icon-btn absolute right-5 top-5 z-10"
              aria-label="关闭设置"
              title={settingsBusy ? "保存完成后可关闭" : "关闭"}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
            <SettingsPage onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} />
            {confirmSettingsClose && (
              <div className="absolute inset-0 z-40 grid place-items-center bg-black/25 p-4" role="alertdialog" aria-label="关闭设置">
                <div className="w-full max-w-sm rounded-md border border-black/10 bg-white p-4 shadow-xl">
                  <h2 className="text-sm font-medium text-[#171717]">放弃未保存的模型设置？</h2>
                  <p className="mt-1.5 text-xs leading-5 text-[#5F6368]">关闭设置会丢失当前连接信息、模型或高级配置的改动。</p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button type="button" onClick={() => setConfirmSettingsClose(false)} className="h-8 rounded-md border border-[#DEDFE1] px-3 text-xs text-[#5F6368]">继续编辑</button>
                    <button type="button" onClick={discardAndCloseSettings} className="h-8 rounded-md bg-[#C43D34] px-3 text-xs font-medium text-white">放弃并关闭</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-5 pt-24 backdrop-blur-[2px]"
          data-testid="search-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="全局搜索"
          onClick={closeTopOverlay}
        >
          <div
            className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-[var(--leemo-bg)] shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <GlobalSearchPage />
          </div>
        </div>
      )}

      {notifPanelOpen && (
        <div className="fixed inset-0 z-50" onClick={closeTopOverlay}>
          <div
            className="absolute right-5 top-14"
            data-testid="notif-panel-anchor"
            onClick={(event) => event.stopPropagation()}
          >
            <NotificationPanel onClose={closeTopOverlay} />
          </div>
        </div>
      )}

      {wikiActive && <WikiPopup />}
    </>
  );
}
