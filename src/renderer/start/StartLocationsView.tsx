import { AlertTriangle, ExternalLink, FolderOpen, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "../bridge/context";
import type { HumanFolderInfo } from "../workspace/client";

export default function StartLocationsView() {
  const workspace = useWorkspace();
  const [folders, setFolders] = useState<HumanFolderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!workspace?.listHumanFolders) {
      setFolders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setFolders(await workspace.listHumanFolders());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "常用文件夹暂时无法读取。");
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => { void reload(); }, [reload]);

  const add = async () => {
    if (!workspace?.pickHumanFolder) return;
    setBusy("add");
    try {
      const added = await workspace.pickHumanFolder();
      if (added) setFolders((current) => [added, ...current.filter((item) => item.id !== added.id)]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法添加这个文件夹。");
    } finally {
      setBusy(null);
    }
  };

  const open = async (folder: HumanFolderInfo) => {
    if (!workspace?.openHumanFolder || !folder.available) return;
    setBusy(folder.id);
    try {
      const touched = await workspace.openHumanFolder(folder.id);
      setFolders((current) => [touched, ...current.filter((item) => item.id !== touched.id)]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法打开这个文件夹。");
      await reload();
    } finally {
      setBusy(null);
    }
  };

  const forget = async (folder: HumanFolderInfo) => {
    if (!workspace?.forgetHumanFolder) return;
    if (!window.confirm(`从常用文件夹中移除「${folder.name}」？\n文件夹和其中的内容不会被删除。`)) return;
    setBusy(`forget:${folder.id}`);
    try {
      await workspace.forgetHumanFolder(folder.id);
      setFolders((current) => current.filter((item) => item.id !== folder.id));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法移除这个快捷入口。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="leemo-start-simple-page leemo-start-locations-page">
      <header className="leemo-start-page-heading leemo-start-locations-heading">
        <div><h1>常用文件夹</h1><p>打开或固定你经常使用的文件夹。</p></div>
        <button type="button" className="leemo-start-pill-button leemo-start-pill-button--accent" onClick={() => void add()} disabled={busy === "add" || !workspace?.pickHumanFolder}>
          <Plus aria-hidden />{busy === "add" ? "正在选择…" : "添加文件夹"}
        </button>
      </header>
      {error && <div className="leemo-start-inline-error" role="alert"><AlertTriangle aria-hidden />{error}</div>}
      {loading ? <div className="leemo-start-locations-state">正在读取…</div> : folders.length === 0 ? (
        <div className="leemo-start-locations-empty">
          <FolderOpen aria-hidden />
          <h2>还没有常用文件夹</h2>
          <p>把文件夹固定在这里，之后可以一键打开。</p>
          <button type="button" className="leemo-start-pill-button leemo-start-pill-button--accent" onClick={() => void add()} disabled={!workspace?.pickHumanFolder}><Plus aria-hidden />添加文件夹</button>
        </div>
      ) : (
        <section className="leemo-start-location-list" aria-label="常用文件夹列表">
          {folders.map((folder) => (
            <article key={folder.id} className={`leemo-start-location-row${folder.available ? "" : " is-missing"}`}>
              <button type="button" className="leemo-start-location-main" aria-label={`打开文件夹 ${folder.name}`} onClick={() => void open(folder)} disabled={!folder.available || busy === folder.id}>
                <span className="leemo-start-location-icon"><FolderOpen aria-hidden /></span>
                <span className="leemo-start-location-copy"><strong>{folder.name}</strong><small>{folder.displayPath}</small></span>
                <span className="leemo-start-location-status">{folder.available ? <><ExternalLink aria-hidden />打开</> : <><AlertTriangle aria-hidden />文件夹不可用</>}</span>
              </button>
              <button type="button" className="leemo-start-location-forget" aria-label={`移除 ${folder.name}`} title="从列表移除" onClick={() => void forget(folder)} disabled={busy === `forget:${folder.id}`}><Trash2 aria-hidden /></button>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
