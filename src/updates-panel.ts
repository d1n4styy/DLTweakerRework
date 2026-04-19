import type { ChangelogItem } from "./release-notes";

export type UpdateTimelineKind = "updates" | "quickpatch";

export type UpdateTimelineDeps = {
  kind: UpdateTimelineKind;
  simplifyBody: (raw: string | null | undefined) => string;
  formatDate: (iso: string) => string;
  trustedUrlPrefixes: string[];
  onOpenUrl: (url: string) => void;
};

function bodyToBulletLines(simplified: string): string[] {
  const raw = simplified.trim();
  if (!raw) return [];
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1) return [raw];
  return lines;
}

/** Одна точка на линии времени: версия → дата → список изменений. */
function createUpdateTimelineItem(
  it: ChangelogItem,
  deps: UpdateTimelineDeps,
  index: number,
  isLatest: boolean,
): HTMLElement {
  const article = document.createElement("article");
  article.className = "updates-timeline-item" + (isLatest ? " is-latest" : "");
  article.setAttribute("role", "listitem");
  article.style.setProperty("--ti", String(index));

  const dot = document.createElement("div");
  dot.className = "updates-timeline-dot";
  dot.setAttribute("aria-hidden", "true");

  const card = document.createElement("div");
  card.className = "updates-timeline-card";

  const title = (it.name && String(it.name).trim()) || (it.tag && String(it.tag).trim()) || "Запись";
  const h = document.createElement("h3");
  h.className = "updates-timeline-version";
  h.textContent = title;

  const meta = document.createElement("p");
  meta.className = "updates-timeline-date";
  const parts = [it.tag && String(it.tag).trim(), deps.formatDate(it.publishedAt)].filter(Boolean);
  meta.textContent = parts.join(" · ");

  const btxt = deps.simplifyBody(it.body);
  const lines = bodyToBulletLines(btxt);

  const bodyWrap = document.createElement("div");
  bodyWrap.className = "updates-timeline-body";
  if (lines.length === 1) {
    const p = document.createElement("p");
    p.className = "updates-timeline-plain";
    p.textContent = lines[0] || "Нет описания.";
    bodyWrap.append(p);
  } else {
    const ul = document.createElement("ul");
    ul.className = "updates-timeline-bullets";
    for (const line of lines) {
      const li = document.createElement("li");
      li.textContent = line.replace(/^[•\-–—]\s*/, "");
      ul.append(li);
    }
    bodyWrap.append(ul);
  }

  card.append(h, meta, bodyWrap);

  if (it.url && deps.trustedUrlPrefixes.some((p) => it.url.startsWith(p))) {
    const row = document.createElement("div");
    row.className = "updates-timeline-actions";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-ghost btn-sm";
    b.textContent = deps.kind === "quickpatch" ? "Quick-patch на GitHub" : "Релиз на GitHub";
    b.addEventListener("click", () => {
      deps.onOpenUrl(it.url);
    });
    row.append(b);
    card.append(row);
  }

  article.append(dot, card);
  return article;
}

/** Вертикальный таймлайн: линия + элементы. `filter` — «важные» = последние 4 записи выбранного типа. */
export function renderUpdateTimeline(
  listEl: HTMLElement,
  items: ChangelogItem[],
  filter: "all" | "important",
  deps: UpdateTimelineDeps,
): void {
  listEl.textContent = "";
  const arr = filter === "important" ? items.slice(0, Math.min(4, items.length)) : items;

  const root = document.createElement("div");
  root.className = "updates-timeline-root";

  const line = document.createElement("div");
  line.className = "updates-timeline-line";
  line.setAttribute("aria-hidden", "true");

  const track = document.createElement("div");
  track.className = "updates-timeline-track";
  track.setAttribute("role", "list");

  arr.forEach((it, idx) => {
    const isLatest = idx === 0;
    track.append(createUpdateTimelineItem(it, deps, idx, isLatest));
  });

  root.append(line, track);
  listEl.append(root);
}
