/**
 * Lightweight DevTools bridge: no UI.
 * Receives openInSources and calls chrome.devtools.panels.openResource.
 * Reconnects after MV3 service-worker restarts.
 */
import { Msg, type OpenInSourcesPayload } from "../shared/protocol";

const tabId = chrome.devtools.inspectedWindow.tabId;

function findLine(content: string, searchText: string): number {
  const lines = content.split(/\r?\n/);
  const methodRe = new RegExp(
    `(?:^|[\\s{};])${escapeRegExp(searchText)}\\s*\\(`,
  );
  for (let i = 0; i < lines.length; i++) {
    if (methodRe.test(lines[i])) return i;
  }
  const classRe = new RegExp(
    `(?:class|ccclass\\(['"\`])\\s*${escapeRegExp(searchText)}`,
  );
  for (let i = 0; i < lines.length; i++) {
    if (classRe.test(lines[i])) return i;
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(searchText)) return i;
  }
  return 0;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function openResource(url: string, line: number, column?: number): void {
  const lineNumber = Math.max(0, line | 0);
  const col = column != null ? Math.max(0, column | 0) : 0;
  try {
    const panels = chrome.devtools.panels as typeof chrome.devtools.panels & {
      openResource(
        url: string,
        lineNumber: number,
        columnNumber?: number | (() => void),
        callback?: () => void,
      ): void;
    };
    if (column != null) {
      panels.openResource(url, lineNumber, col, () => {
        void chrome.runtime.lastError;
      });
    } else {
      panels.openResource(url, lineNumber, () => {
        void chrome.runtime.lastError;
      });
    }
  } catch (err) {
    console.warn("[cc-runtime] openResource failed:", err);
  }
}

function getContent(resource: chrome.devtools.inspectedWindow.Resource) {
  return new Promise<{ content: string; encoding: string }>((resolve) => {
    resource.getContent((content, encoding) => {
      resolve({ content: content || "", encoding: encoding || "" });
    });
  });
}

function urlLooksLikeScript(url: string): boolean {
  return /\.(m?[jt]sx?|cjs)(\?|#|$)/i.test(url) || /\/(scripting|assets)\//i.test(url);
}

function urlMatchesHint(url: string, hint: string): boolean {
  if (!hint) return false;
  try {
    const path = new URL(url, "http://x").pathname.toLowerCase();
    const h = hint.toLowerCase();
    return (
      path.includes(`/${h}.`) ||
      path.includes(`/${h}/`) ||
      path.endsWith(`/${h}`) ||
      url.toLowerCase().includes(h)
    );
  } catch {
    return url.toLowerCase().includes(hint.toLowerCase());
  }
}

async function findInResources(
  resources: chrome.devtools.inspectedWindow.Resource[],
  preferredUrl: string | undefined,
  needles: string[],
): Promise<{ url: string; line: number } | null> {
  const list = resources.filter((r) => r?.url && !r.url.startsWith("chrome-extension:"));

  const preferred =
    (preferredUrl && list.find((r) => r.url === preferredUrl)) ||
    (preferredUrl &&
      list.find(
        (r) => r.url.endsWith(preferredUrl) || preferredUrl.endsWith(r.url),
      ));

  const ordered = preferred
    ? [preferred, ...list.filter((r) => r !== preferred)]
    : [...list].sort((a, b) => {
        const as = urlLooksLikeScript(a.url) ? 0 : 1;
        const bs = urlLooksLikeScript(b.url) ? 0 : 1;
        if (as !== bs) return as - bs;
        for (const n of needles) {
          const am = urlMatchesHint(a.url, n) ? 0 : 1;
          const bm = urlMatchesHint(b.url, n) ? 0 : 1;
          if (am !== bm) return am - bm;
        }
        return 0;
      });

  // Prefer URL-hinted resources first (cheap), then content search.
  const hinted = ordered.filter((r) =>
    needles.some((n) => urlMatchesHint(r.url, n)),
  );
  const scan = hinted.length ? [...hinted, ...ordered.filter((r) => !hinted.includes(r))] : ordered;

  const maxScan = Math.min(scan.length, hinted.length ? 40 : 80);
  for (let i = 0; i < maxScan; i++) {
    const r = scan[i];
    if (!urlLooksLikeScript(r.url) && !needles.some((n) => urlMatchesHint(r.url, n))) {
      continue;
    }
    const { content, encoding } = await getContent(r);
    if (!content || encoding === "base64") continue;
    for (const needle of needles) {
      if (!needle) continue;
      if (!content.includes(needle)) continue;
      return { url: r.url, line: findLine(content, needle) };
    }
  }

  if (preferred) return { url: preferred.url, line: 0 };
  return null;
}

function consoleLogFallback(): void {
  chrome.devtools.inspectedWindow.eval(
    `(function(){
      var x = window.__ccRuntimeInspect;
      if (!x) return false;
      var label = (x.className || '') + (x.handler ? '.' + x.handler : '');
      var target = typeof x.fn === 'function' ? x.fn : null;
      if (!target) return false;
      console.log('%c[cc-runtime]%c 点击函数跳转到 Sources: ' + label, 'color:#4fc3f7;font-weight:bold', 'color:inherit', target);
      return true;
    })()`,
    (result, exceptionInfo) => {
      if (exceptionInfo) {
        console.warn("[cc-runtime] console fallback failed", exceptionInfo);
      } else if (!result) {
        console.warn("[cc-runtime] no stashed function for Sources fallback");
      }
    },
  );
}

async function resolveAndOpen(payload: OpenInSourcesPayload): Promise<void> {
  const needles = [payload.searchText, payload.className].filter(
    (s): s is string => !!s && !!String(s).trim(),
  );

  if (payload.url && typeof payload.line === "number" && !payload.searchText) {
    openResource(payload.url, payload.line, payload.column);
    return;
  }

  chrome.devtools.inspectedWindow.getResources((resources) => {
    void (async () => {
      const found = await findInResources(resources || [], payload.url, needles);
      if (found) {
        openResource(found.url, found.line, payload.column);
        return;
      }
      if (payload.url) {
        openResource(payload.url, typeof payload.line === "number" ? payload.line : 0, payload.column);
        return;
      }
      if (payload.hasFn) {
        consoleLogFallback();
      }
    })();
  });
}

function connect() {
  const port = chrome.runtime.connect({ name: "cc-runtime-devtools" });
  port.postMessage({ type: "bind", tabId });
  port.onMessage.addListener((msg) => {
    const m = msg as { type?: string } & OpenInSourcesPayload;
    if (m?.type !== Msg.openInSources) return;
    void resolveAndOpen(m);
  });
  port.onDisconnect.addListener(() => {
    // MV3 SW restart drops the port; reconnect so jumps keep working.
    setTimeout(connect, 300);
  });
}

connect();
