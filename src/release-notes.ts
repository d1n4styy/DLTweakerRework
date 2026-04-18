const GH_RELEASES_API =
  "https://api.github.com/repos/d1n4styy/DLTweakerRework/releases?per_page=12";
const QP_TREE = "https://github.com/d1n4styy/DLTweaker/tree/main/quick-patch";

export type ChangelogItem = {
  tag: string;
  name: string;
  publishedAt: string;
  body: string;
  url: string;
};

function sanitizeSnippet(s: string, max = 400): string {
  return s.replace(/<[^>]+>/g, " ").slice(0, max);
}

export async function fetchReleaseNotes(): Promise<
  | { ok: true; items: ChangelogItem[]; quickPatchItems: ChangelogItem[] }
  | { ok: false; message: string; detail?: string }
> {
  const ac = new AbortController();
  const to = window.setTimeout(() => ac.abort(), 12_000);
  try {
    const res = await fetch(GH_RELEASES_API, {
      signal: ac.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "DeadlockTweaker-Tauri/rework",
      },
    });
    const bodyText = await res.text().catch(() => "");
    if (!res.ok) {
      return {
        ok: false,
        message: `GitHub API: ${res.status}`,
        detail: sanitizeSnippet(bodyText) || undefined,
      };
    }
    const head = bodyText.trimStart().slice(0, 1);
    if (head === "<") {
      return {
        ok: false,
        message: "GitHub вернул HTML вместо списка релизов (сеть или лимит запросов).",
      };
    }
    let data: unknown;
    try {
      data = JSON.parse(bodyText);
    } catch {
      return { ok: false, message: "Не удалось разобрать ответ GitHub API." };
    }
    if (!Array.isArray(data)) {
      return { ok: false, message: "Неожиданный ответ API" };
    }

    let bundled: Record<string, string> = {};
    try {
      const br = await fetch("/release-notes.json", { cache: "no-cache" });
      if (br.ok) bundled = (await br.json()) as Record<string, string>;
    } catch {
      bundled = {};
    }

    const items: ChangelogItem[] = data.map((r: Record<string, unknown>) => {
      const tag = r.tag_name != null ? String(r.tag_name) : "";
      const apiBody = typeof r.body === "string" ? r.body.trim() : "";
      const fromBundle = tag && bundled[tag] != null ? String(bundled[tag]).trim() : "";
      const body = apiBody || fromBundle;
      return {
        tag,
        name: r.name != null ? String(r.name) : "",
        publishedAt: r.published_at != null ? String(r.published_at) : "",
        body,
        url: typeof r.html_url === "string" ? r.html_url : "",
      };
    });

    let qpRows: { id?: string; date?: string; description?: string; body?: string }[] = [];
    try {
      const r = await fetch("/quick-patch-changelog.json", { cache: "no-cache" });
      if (r.ok) {
        const j = await r.json();
        qpRows = Array.isArray(j) ? j : Array.isArray((j as { items?: unknown }).items) ? (j as { items: typeof qpRows }).items : [];
      }
    } catch {
      qpRows = [];
    }

    const quickPatchItems: ChangelogItem[] = qpRows.map((row) => {
      const id = row.id != null ? String(row.id).trim() : "";
      const description =
        row.description != null
          ? String(row.description).trim()
          : String(row.body ?? "").trim();
      const date = row.date != null ? String(row.date).trim() : "";
      return {
        tag: id ? `qp:${id}` : "qp",
        name: id ? `Quick-patch · ${id}` : "Quick-patch",
        publishedAt: date,
        body: description,
        url: QP_TREE,
      };
    });

    return { ok: true, items, quickPatchItems };
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string };
    const raw =
      e?.name === "AbortError"
        ? "Таймаут запроса к GitHub"
        : e?.message
          ? String(e.message)
          : "Запрос не выполнен";
    return { ok: false, message: sanitizeSnippet(raw, 200) };
  } finally {
    window.clearTimeout(to);
  }
}
