import type { ChangelogItem } from "./release-notes";

export type UpdateTimelineKind = "updates" | "quickpatch";

export type UpdateTimelineDeps = {
  kind: UpdateTimelineKind;
  simplifyBody: (raw: string | null | undefined) => string;
  formatDate: (iso: string) => string;
  trustedUrlPrefixes: string[];
  onOpenUrl: (url: string) => void;
  /** Локализованные подписи. Передаются через deps, чтобы модуль не зависел напрямую от `./i18n`. */
  labels?: {
    openRelease?: string;
    openQp?: string;
    noDescription?: string;
    sectionFunctionality?: string;
    sectionInterface?: string;
  };
};

/** Запись считается «важной» (фильтр Important), если в неё попал непустой
 *  блок `functionality`. Legacy-строки без секций в релизах остаются важными
 *  (мы не знаем их разбивки и не хотим их терять), а в quick-patch — наоборот
 *  по умолчанию не важные (квик-патчи по природе косметические). */
export function isImportantChangelogItem(
  it: ChangelogItem,
  kind: UpdateTimelineKind,
): boolean {
  if (it.sections?.functionality && it.sections.functionality.length > 0) return true;
  if (it.sections) return false; // есть структура, но functionality пуст → только интерфейс
  return kind !== "quickpatch";
}

/** Добавляет в `host` блок «<заголовок> + ul с bullets». Если bullets пусты — ничего не добавляет. */
function appendSection(
  host: HTMLElement,
  title: string,
  bullets: string[] | undefined,
  modifierClass: string,
): void {
  if (!bullets || bullets.length === 0) return;
  const section = document.createElement("div");
  section.className = `updates-timeline-part ${modifierClass}`;

  const h = document.createElement("h4");
  h.className = "updates-timeline-part-title";
  h.textContent = title;
  section.append(h);

  const ul = document.createElement("ul");
  ul.className = "updates-timeline-bullets";
  for (const line of bullets) {
    const li = document.createElement("li");
    li.textContent = line.replace(/^[•\-–—]\s*/, "");
    ul.append(li);
  }
  section.append(ul);
  host.append(section);
}

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

  const tag = it.tag ? String(it.tag).trim() : "";
  const name = it.name ? String(it.name).trim() : "";
  // Если name содержит сам tag («… v0.1.5»), показываем только tag; иначе — name
  const title = name && tag && name.includes(tag) ? tag : (name || tag || "Запись");

  const head = document.createElement("div");
  head.className = "updates-timeline-head-row";

  const h = document.createElement("h3");
  h.className = "updates-timeline-version";
  h.textContent = title;
  head.append(h);

  if (isLatest) {
    const badge = document.createElement("span");
    badge.className = "updates-timeline-badge";
    badge.textContent = deps.kind === "quickpatch" ? "ACTIVE" : "NEW";
    head.append(badge);
  }

  if (tag && title !== tag) {
    const pill = document.createElement("span");
    pill.className = "updates-timeline-tag";
    pill.textContent = tag;
    head.append(pill);
  }

  const meta = document.createElement("p");
  meta.className = "updates-timeline-date";
  const dateText = deps.formatDate(it.publishedAt);
  meta.textContent = dateText || (tag && title === tag ? "" : tag);

  const bodyWrap = document.createElement("div");
  bodyWrap.className = "updates-timeline-body";
  const noDescLabel = deps.labels?.noDescription ?? "Нет описания.";

  // Если запись имеет структурированные секции (functionality/interface) — рендерим
  // каждую секцию с подзаголовком. Иначе (legacy-строка) — старый рендер из bullets.
  if (it.sections && (it.sections.functionality?.length || it.sections.interface?.length)) {
    appendSection(
      bodyWrap,
      deps.labels?.sectionFunctionality ?? "Функционал",
      it.sections.functionality,
      "updates-timeline-section--fn",
    );
    appendSection(
      bodyWrap,
      deps.labels?.sectionInterface ?? "Интерфейс",
      it.sections.interface,
      "updates-timeline-section--ui",
    );
  } else {
    const btxt = deps.simplifyBody(it.body);
    const lines = bodyToBulletLines(btxt);
    if (lines.length === 1) {
      const p = document.createElement("p");
      p.className = "updates-timeline-plain";
      p.textContent = lines[0] || noDescLabel;
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
  }

  card.append(head, meta, bodyWrap);

  if (it.url && deps.trustedUrlPrefixes.some((p) => it.url.startsWith(p))) {
    const row = document.createElement("div");
    row.className = "updates-timeline-actions";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-ghost btn-sm";
    const openReleaseLabel = deps.labels?.openRelease ?? "Релиз на GitHub";
    const openQpLabel = deps.labels?.openQp ?? "Quick-patch на GitHub";
    b.textContent = deps.kind === "quickpatch" ? openQpLabel : openReleaseLabel;
    b.addEventListener("click", () => {
      deps.onOpenUrl(it.url);
    });
    row.append(b);
    card.append(row);
  }

  article.append(dot, card);
  return article;
}

/** Вертикальный таймлайн: линия + элементы. `filter === "important"` — только записи
 *  с непустой секцией `functionality` (см. `isImportantChangelogItem`). */
export function renderUpdateTimeline(
  listEl: HTMLElement,
  items: ChangelogItem[],
  filter: "all" | "important",
  deps: UpdateTimelineDeps,
): void {
  listEl.textContent = "";
  const arr = filter === "important" ? items.filter((it) => isImportantChangelogItem(it, deps.kind)) : items;

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
