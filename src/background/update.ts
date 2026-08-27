import { Msg } from "../shared/protocol";
import {
  githubRepoFromHomepage,
  isNewerVersion,
  normalizeVersion,
  type UpdateStatus,
} from "../shared/update";

const STORAGE_KEY = "cc-runtime::update";
const ALARM_NAME = "cc-runtime-update";
const CACHE_MS = 60 * 60 * 1000;
const ALARM_MINUTES = 360;

type StoredUpdate = {
  lastCheck: number;
  etag?: string;
  ignoredVersion?: string;
  latest?: string;
  zipUrl?: string;
  zipName?: string;
  htmlUrl?: string;
};

type GithubAsset = {
  name: string;
  browser_download_url: string;
};

type GithubRelease = {
  tag_name: string;
  html_url: string;
  assets?: GithubAsset[];
};

function currentVersion(): string {
  return chrome.runtime.getManifest().version;
}

function emptyStatus(): UpdateStatus {
  return { current: currentVersion(), available: false };
}

async function readStore(): Promise<StoredUpdate> {
  const bag = await chrome.storage.local.get(STORAGE_KEY);
  return (bag[STORAGE_KEY] as StoredUpdate) || { lastCheck: 0 };
}

async function writeStore(next: StoredUpdate): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

function pickZip(assets: GithubAsset[] | undefined): GithubAsset | undefined {
  const zips = (assets || []).filter((a) =>
    a.name.toLowerCase().endsWith(".zip"),
  );
  return (
    zips.find((a) => /^cc-runtime-.*\.zip$/i.test(a.name)) || zips[0]
  );
}

function toStatus(store: StoredUpdate, force: boolean): UpdateStatus {
  const current = currentVersion();
  const latest = store.latest;
  if (!latest || !isNewerVersion(latest, current)) {
    return { current, latest, available: false, htmlUrl: store.htmlUrl };
  }
  const ignored =
    !force &&
    store.ignoredVersion != null &&
    normalizeVersion(store.ignoredVersion) === normalizeVersion(latest);
  return {
    current,
    latest: normalizeVersion(latest),
    available: !ignored,
    zipUrl: store.zipUrl,
    zipName: store.zipName,
    htmlUrl: store.htmlUrl,
  };
}

async function applyBadge(status: UpdateStatus): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: "#00a6ff" });
  await chrome.action.setBadgeText({ text: status.available ? "↑" : "" });
}

async function fetchLatest(
  repo: string,
  etag?: string,
): Promise<{ release?: GithubRelease; etag?: string; notModified: boolean }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": `cc-runtime/${currentVersion()}`,
  };
  if (etag) headers["If-None-Match"] = etag;
  const res = await fetch(
    `https://api.github.com/repos/${repo}/releases/latest`,
    { headers },
  );
  if (res.status === 304) return { notModified: true, etag };
  if (!res.ok) return { notModified: false };
  const release = (await res.json()) as GithubRelease;
  return {
    release,
    etag: res.headers.get("ETag") || undefined,
    notModified: false,
  };
}

export async function checkForUpdate(force: boolean): Promise<UpdateStatus> {
  const store = await readStore();
  const now = Date.now();
  if (!force && now - store.lastCheck < CACHE_MS && store.latest) {
    const cached = toStatus(store, force);
    await applyBadge(cached);
    return cached;
  }

  const repo = githubRepoFromHomepage(
    chrome.runtime.getManifest().homepage_url,
  );
  if (!repo) {
    const status = emptyStatus();
    await applyBadge(status);
    return status;
  }

  try {
    const fetched = await fetchLatest(repo, force ? undefined : store.etag);
    if (fetched.notModified) {
      const next = { ...store, lastCheck: now };
      await writeStore(next);
      const status = toStatus(next, force);
      await applyBadge(status);
      return status;
    }
    const release = fetched.release;
    if (!release?.tag_name) {
      const next = { ...store, lastCheck: now };
      await writeStore(next);
      const status = toStatus(next, force);
      await applyBadge(status);
      return status;
    }
    const zip = pickZip(release.assets);
    const next: StoredUpdate = {
      lastCheck: now,
      etag: fetched.etag,
      ignoredVersion: store.ignoredVersion,
      latest: release.tag_name,
      htmlUrl: release.html_url,
      zipUrl: zip?.browser_download_url,
      zipName: zip?.name,
    };
    await writeStore(next);
    const status = toStatus(next, force);
    await applyBadge(status);
    return status;
  } catch (err) {
    console.warn("[cc-runtime] update check failed:", err);
    const status = toStatus(store, force);
    await applyBadge(status);
    return status;
  }
}

export async function ignoreCurrentLatest(): Promise<UpdateStatus> {
  const store = await readStore();
  if (store.latest) {
    await writeStore({ ...store, ignoredVersion: store.latest });
  }
  const status = toStatus({ ...store, ignoredVersion: store.latest }, false);
  await applyBadge(status);
  return status;
}

export function handleUpdateMessage(
  msg: { type?: string; force?: boolean },
  sendResponse: (res: unknown) => void,
): boolean {
  if (msg?.type === Msg.checkUpdate) {
    void checkForUpdate(!!msg.force).then(sendResponse);
    return true;
  }
  if (msg?.type === Msg.ignoreUpdate) {
    void ignoreCurrentLatest().then(sendResponse);
    return true;
  }
  return false;
}

export function initAutoUpdate() {
  void chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_MINUTES });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) void checkForUpdate(false);
  });
  chrome.runtime.onInstalled.addListener(() => {
    void checkForUpdate(true);
  });
  void checkForUpdate(false);
}
