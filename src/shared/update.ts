export type UpdateStatus = {
  current: string;
  latest?: string;
  available: boolean;
  zipUrl?: string;
  zipName?: string;
  htmlUrl?: string;
};

export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, "");
}

export function isNewerVersion(remote: string, local: string): boolean {
  const a = normalizeVersion(remote)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const b = normalizeVersion(local)
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

export function githubRepoFromHomepage(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
  if (!m) return null;
  return `${m[1]}/${m[2].replace(/\.git$/, "")}`;
}
