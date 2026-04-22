const GH_RELEASES_API =
  "https://api.github.com/repos/d1n4styy/DLTweakerRework/releases?per_page=12";
const QP_TREE = "https://github.com/d1n4styy/DLTweakerRework/tree/main/quick-patch";

export type ChangelogSections = {
  /** Новые фичи / изменения логики. Только эти секции попадают в фильтр «Важные». */
  functionality?: string[];
  /** Правки UI/верстки/локализации — в фильтре «Все», но не в «Важные». */
  interface?: string[];
};

export type ChangelogItem = {
  tag: string;
  name: string;
  publishedAt: string;
  /** Описание на языке по умолчанию (RU) — склеенный текст, для fallback-рендера и old-style записей. */
  body: string;
  /** Описание на английском, если предоставлено переводом. */
  bodyEn?: string;
  /** Структурированное описание RU (если в bundled JSON лежит объект, а не строка). */
  sections?: ChangelogSections;
  /** Структурированное описание EN. */
  sectionsEn?: ChangelogSections;
  url: string;
};

type RawNote = string | { functionality?: unknown; interface?: unknown } | undefined | null;

/** Преобразует значение из bundled JSON к `{ body, sections }`.
 * — Строка: `sections = undefined`, `body = строка`.
 * — Объект: `sections` — нормализованные массивы строк, `body` — склейка для fallback. */
function parseNote(raw: RawNote): { body: string; sections?: ChangelogSections } {
  if (raw == null) return { body: "" };
  if (typeof raw === "string") return { body: raw.trim() };
  if (typeof raw === "object") {
    const toArr = (v: unknown): string[] => {
      if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
      if (typeof v === "string") {
        return v
          .split("\n")
          .map((s) => s.replace(/^[•\-–—]\s*/, "").trim())
          .filter(Boolean);
      }
      return [];
    };
    const fn = toArr(raw.functionality);
    const ui = toArr(raw.interface);
    const sections: ChangelogSections = {};
    if (fn.length) sections.functionality = fn;
    if (ui.length) sections.interface = ui;
    const bodyParts = [...fn, ...ui].map((s) => `— ${s}`).join("\n");
    return { body: bodyParts, sections };
  }
  return { body: "" };
}

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

    let bundled: Record<string, RawNote> = {};
    try {
      const br = await fetch("/release-notes.json", { cache: "no-cache" });
      if (br.ok) bundled = (await br.json()) as Record<string, RawNote>;
    } catch {
      bundled = {};
    }

    let bundledEn: Record<string, RawNote> = {};
    try {
      const br = await fetch("/release-notes.en.json", { cache: "no-cache" });
      if (br.ok) bundledEn = (await br.json()) as Record<string, RawNote>;
    } catch {
      bundledEn = {};
    }

    const items: ChangelogItem[] = data.map((r: Record<string, unknown>) => {
      const tag = r.tag_name != null ? String(r.tag_name) : "";
      const apiBody = typeof r.body === "string" ? r.body.trim() : "";
      const ru = parseNote(tag ? bundled[tag] : undefined);
      const en = parseNote(tag ? bundledEn[tag] : undefined);
      // Приоритет RU-тела: сначала структурированное (если есть), затем api, затем legacy-строка бандла.
      const body = ru.sections ? ru.body : apiBody || ru.body;
      return {
        tag,
        name: r.name != null ? String(r.name) : "",
        publishedAt: r.published_at != null ? String(r.published_at) : "",
        body,
        bodyEn: en.body || undefined,
        sections: ru.sections,
        sectionsEn: en.sections,
        url: typeof r.html_url === "string" ? r.html_url : "",
      };
    });

    let qpRows: { id?: string; date?: string; description?: string; descriptionEn?: string; body?: string }[] = [];
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
      const descriptionEn =
        row.descriptionEn != null ? String(row.descriptionEn).trim() : "";
      const date = row.date != null ? String(row.date).trim() : "";
      return {
        tag: id ? `qp:${id}` : "qp",
        name: id ? `Quick-patch · ${id}` : "Quick-patch",
        publishedAt: date,
        body: description,
        bodyEn: descriptionEn || undefined,
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
