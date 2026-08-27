import React, { useCallback, useEffect, useState } from "react";
import { Button, message } from "antd";
import { Msg } from "@shared/protocol";
import type { UpdateStatus } from "@shared/update";
import { getInspectedTabId } from "./bridge/rpc";

function sendUpdate<T>(payload: { type: string; force?: boolean }): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (res: T) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(res);
    });
  });
}

function downloadZip(url: string, filename?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename: filename || "cc-runtime.zip",
        saveAs: false,
        conflictAction: "uniquify",
      },
      (id) => {
        if (chrome.runtime.lastError || id == null) {
          reject(
            new Error(chrome.runtime.lastError?.message || "下载失败"),
          );
          return;
        }
        const onChanged = (delta: chrome.downloads.DownloadDelta) => {
          if (delta.id !== id) return;
          if (delta.state?.current === "complete") {
            chrome.downloads.onChanged.removeListener(onChanged);
            resolve(id);
          } else if (delta.state?.current === "interrupted") {
            chrome.downloads.onChanged.removeListener(onChanged);
            reject(new Error("下载中断"));
          }
        };
        chrome.downloads.onChanged.addListener(onChanged);
      },
    );
  });
}

const FORCE_CHECK_EVENT = "cc-runtime-force-update-check";

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadId, setDownloadId] = useState<number | null>(null);

  const refresh = useCallback(async (force: boolean) => {
    const next = await sendUpdate<UpdateStatus>({
      type: Msg.checkUpdate,
      force,
    });
    setStatus(next);
    if (force) setDownloadId(null);
    return next;
  }, []);

  useEffect(() => {
    void refresh(false).catch((err) => {
      console.warn("[cc-runtime] update check failed:", err);
    });
    const onForce = () => {
      void refresh(true)
        .then((next) => {
          if (next.available) {
            message.success(`发现新版本 ${next.latest}`);
          } else {
            message.info(`已是最新版本（${next.current}）`);
          }
        })
        .catch((err) => {
          console.error(err);
          message.error("检查更新失败");
        });
    };
    window.addEventListener(FORCE_CHECK_EVENT, onForce);
    return () => window.removeEventListener(FORCE_CHECK_EVENT, onForce);
  }, [refresh]);

  const onDownload = async () => {
    if (!status?.zipUrl) {
      if (status?.htmlUrl) chrome.tabs.create({ url: status.htmlUrl });
      else message.error("Release 中没有 zip 附件");
      return;
    }
    setBusy(true);
    try {
      const id = await downloadZip(status.zipUrl, status.zipName);
      setDownloadId(id);
      message.success(
        "已下载。请解压并覆盖当初加载的扩展文件夹，然后点「重新加载」",
      );
    } catch (err) {
      console.error(err);
      if (status.htmlUrl) {
        chrome.tabs.create({ url: status.htmlUrl });
        message.info("已打开 Release 页面，请手动下载");
      } else {
        message.error("下载失败");
      }
    } finally {
      setBusy(false);
    }
  };

  const onShow = () => {
    if (downloadId != null) chrome.downloads.show(downloadId);
  };

  const onReload = () => {
    chrome.runtime.sendMessage(
      { type: Msg.reloadExtension, tabId: getInspectedTabId() },
      () => {
        void chrome.runtime.lastError;
      },
    );
  };

  const onIgnore = async () => {
    const next = await sendUpdate<UpdateStatus>({ type: Msg.ignoreUpdate });
    setStatus(next);
  };

  if (!status?.available) return null;

  return (
    <div className="update-banner">
      <span>
        {downloadId != null
          ? "已下载。请解压覆盖原扩展文件夹，然后点「重新加载」（会先刷新游戏页）"
          : `发现新版本 ${status.latest}（当前 ${status.current}）`}
      </span>
      <span className="update-banner-actions">
        {downloadId != null ? (
          <>
            <Button size="small" onClick={onShow}>
              打开文件
            </Button>
            <Button
              size="small"
              type="primary"
              onClick={onReload}
            >
              重新加载
            </Button>
          </>
        ) : (
          <Button
            size="small"
            type="primary"
            loading={busy}
            onClick={() => void onDownload()}
          >
            下载更新
          </Button>
        )}
        <Button size="small" onClick={() => void onIgnore()}>
          忽略
        </Button>
      </span>
    </div>
  );
}

export function checkUpdateNow() {
  window.dispatchEvent(new Event(FORCE_CHECK_EVENT));
}
