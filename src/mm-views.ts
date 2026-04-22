// Экраны режима Mod Manager: Overview / Installed / My Mods / Categories / Collections / Downloads / Settings.
// Данные берём из нашего `mod_manager`-бэкенда (GameBanana API + локальный индекс)
// и из небольших вспомогательных `app_restore_*` команд для App Restore.

import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t } from "./i18n";

type BrowseItem = {
  id: number;
  name: string;
  profileUrl: string;
  thumbnail: string;
  author: string;
  category: string;
  likes: number;
  views: number;
  hasFiles: boolean;
  dateUpdated: number;
};

type BrowseResponse = {
  items: BrowseItem[];
  total: number;
  page: number;
  perPage: number;
};

type InstalledItem = {
  modId: number;
  name: string;
  author: string;
  thumbnail: string;
  profileUrl: string;
  sourceFile: string;
  files: string[];
  installedAt: number;
  filesTotal: number;
  disabledCount: number;
  enabled: boolean;
  present: boolean;
};

type InstalledResponse = {
  items: InstalledItem[];
  addonsPath: string | null;
};

type RestorePoint = {
  id: string;
  version: string;
  label?: string;
  createdAt: number;
  sizeBytes: number;
};

let bound = false;

// ---- Public entry -------------------------------------------------------

/** Вызывается когда пользователь переключается в режим Mod Manager или внутри режима меняет view. */
export function onModManagerActive(view?: string): void {
  ensureBound();

  const target = view ?? (document.querySelector<HTMLElement>(".view-mm:not(.hidden)")?.dataset.viewPanel || "mm-overview");
  switch (target) {
    case "mm-overview":
      void loadOverview();
      break;
    case "mm-installed":
      void loadInstalledTable();
      break;
    case "mm-my-mods":
      renderMyMods();
      break;
    case "mm-categories":
      renderCategories();
      break;
    case "mm-collections":
      renderCollections();
      break;
    case "mm-downloads":
      renderDownloads();
      break;
    case "mm-settings":
      void loadRestorePoints();
      break;
  }
  void refreshOverviewStats();
}

function ensureBound(): void {
  if (bound) return;
  bound = true;

  document.addEventListener("mm-view:change", (e) => {
    const v = (e as CustomEvent<{ view: string }>).detail?.view;
    onModManagerActive(v);
  });

  // Overview: быстрая установка через кнопку «+ Install Mod» → просто переключаемся на Installed.
  document.getElementById("mm-install-mod-btn")?.addEventListener("click", () => {
    (document.querySelector<HTMLElement>("#nav-mm [data-mm-view=\"installed\"]"))?.click();
  });

  // Grid/List toggle (чисто визуальный для Overview).
  document.querySelectorAll<HTMLElement>(".mm-view-toggle__btn").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll<HTMLElement>(".mm-view-toggle__btn").forEach((x) => x.classList.remove("is-active"));
      b.classList.add("is-active");
      document.documentElement.dataset.mmLayout = b.dataset.mmLayout ?? "grid";
    });
  });

  // App Restore кнопки.
  document.getElementById("mm-restore-create")?.addEventListener("click", () => void createRestorePoint());
}

// ---- Overview -----------------------------------------------------------

async function loadOverview(): Promise<void> {
  const featuredEl = document.getElementById("mm-featured-grid");
  const recentEl = document.getElementById("mm-recent-list");
  const status = document.getElementById("mm-featured-status");
  if (!featuredEl || !recentEl) return;

  featuredEl.textContent = "";
  recentEl.textContent = "";
  if (status) status.textContent = t("mods.loading");

  renderCategoriesSidebar();
  renderCollectionsSidebar();

  if (!isTauri()) {
    if (status) status.textContent = t("mods.tauriOnly");
    return;
  }

  try {
    const res = await invoke<BrowseResponse>("mod_manager_browse", {
      args: { page: 1, per_page: 20, query: "" },
    });
    if (status) status.textContent = "";

    const featured = res.items.slice(0, 4);
    for (const it of featured) featuredEl.append(featuredCard(it));

    const recent = res.items.slice(4, 10);
    for (const it of recent) recentEl.append(recentRow(it));

    updateOverviewTotal(res.total);
  } catch (e) {
    if (status) {
      status.classList.add("is-error");
      status.textContent = e instanceof Error ? e.message : String(e);
    }
  }
}

function featuredCard(it: BrowseItem): HTMLElement {
  const card = document.createElement("article");
  card.className = "mm-featured-card";

  const media = document.createElement("div");
  media.className = "mm-featured-card__media";
  if (it.thumbnail) {
    const img = document.createElement("img");
    img.src = it.thumbnail;
    img.alt = "";
    img.loading = "lazy";
    media.append(img);
  }
  const cat = document.createElement("span");
  cat.className = "mm-featured-card__cat-pill";
  cat.textContent = it.category || "—";
  media.append(cat);
  card.append(media);

  const body = document.createElement("div");
  body.className = "mm-featured-card__body";

  const title = document.createElement("div");
  title.className = "mm-featured-card__title";
  const h = document.createElement("strong");
  h.textContent = it.name;
  title.append(h);
  const ver = document.createElement("span");
  ver.className = "mm-featured-card__ver";
  ver.textContent = `v${(it.dateUpdated % 100) / 10 + 1}.${(it.likes % 9) + 0}`; // mock-версия для вида
  title.append(ver);
  body.append(title);

  const desc = document.createElement("p");
  desc.className = "mm-featured-card__desc";
  desc.textContent = describeMod(it);
  body.append(desc);

  const meta = document.createElement("p");
  meta.className = "mm-featured-card__meta";
  meta.textContent = `${it.category || "—"}`;
  body.append(meta);

  const foot = document.createElement("div");
  foot.className = "mm-featured-card__foot";
  const stats = document.createElement("span");
  stats.className = "mm-featured-card__stats";
  stats.innerHTML = `<span aria-hidden="true">★</span> ${ratingLabel(it)} &nbsp; <span aria-hidden="true">⤓</span> ${shortCount(it.views)}`;
  foot.append(stats);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-primary btn-sm";
  btn.textContent = t("mods.install");
  btn.addEventListener("click", () => void directInstall(it, btn));
  foot.append(btn);
  body.append(foot);

  card.append(body);
  return card;
}

function recentRow(it: BrowseItem): HTMLElement {
  const li = document.createElement("li");
  li.className = "mm-recent-row";

  const thumb = document.createElement("div");
  thumb.className = "mm-recent-row__thumb";
  if (it.thumbnail) {
    const img = document.createElement("img");
    img.src = it.thumbnail;
    img.alt = "";
    img.loading = "lazy";
    thumb.append(img);
  }
  li.append(thumb);

  const name = document.createElement("div");
  name.className = "mm-recent-row__name";
  const n = document.createElement("strong");
  n.textContent = it.name;
  name.append(n);
  const v = document.createElement("span");
  v.className = "mm-recent-row__ver";
  v.textContent = `v${1 + (it.likes % 4)}.${it.likes % 9}`;
  name.append(v);
  li.append(name);

  const cat = document.createElement("span");
  cat.className = "mm-recent-row__cat";
  cat.textContent = it.category || "—";
  li.append(cat);

  const date = document.createElement("span");
  date.className = "mm-recent-row__date";
  date.textContent = relDate(it.dateUpdated);
  li.append(date);

  const rating = document.createElement("span");
  rating.className = "mm-recent-row__rating";
  rating.innerHTML = `★ ${ratingLabel(it)}`;
  li.append(rating);

  const dl = document.createElement("span");
  dl.className = "mm-recent-row__dl";
  dl.textContent = `⤓ ${shortCount(it.views)}`;
  li.append(dl);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-primary btn-sm";
  btn.textContent = t("mods.install");
  btn.addEventListener("click", () => void directInstall(it, btn));
  li.append(btn);

  return li;
}

async function directInstall(it: BrowseItem, btn: HTMLButtonElement): Promise<void> {
  if (!isTauri()) return;
  btn.disabled = true;
  const orig = btn.textContent ?? "";
  btn.textContent = t("mods.installing");
  try {
    const filesRes = await invoke<{ modId: number; files: { fileId: number; name: string }[] }>(
      "mod_manager_mod_files",
      { modId: it.id },
    );
    const first = filesRes.files[0];
    if (!first) throw new Error(t("mods.filesEmpty"));
    await invoke("mod_manager_install", {
      args: {
        mod_id: it.id,
        file_id: first.fileId,
        name: it.name,
        author: it.author,
        thumbnail: it.thumbnail,
        profile_url: it.profileUrl,
      },
    });
    btn.textContent = t("mm.installed");
    void refreshOverviewStats();
  } catch (e) {
    btn.textContent = e instanceof Error ? e.message.slice(0, 24) : t("updates.msg.error");
    btn.classList.add("is-error");
    setTimeout(() => {
      btn.disabled = false;
      btn.classList.remove("is-error");
      btn.textContent = orig;
    }, 2800);
  }
}

// ---- Installed (table) --------------------------------------------------

async function loadInstalledTable(): Promise<void> {
  const tbody = document.getElementById("mm-installed-tbody");
  const summary = document.getElementById("mm-installed-summary");
  const empty = document.getElementById("mm-installed-empty");
  if (!tbody) return;
  tbody.textContent = "";
  if (summary) summary.textContent = t("mods.loading");

  if (!isTauri()) {
    if (summary) summary.textContent = t("mods.tauriOnly");
    return;
  }

  try {
    const res = await invoke<InstalledResponse>("mod_manager_list_installed");
    if (res.items.length === 0) {
      if (summary) summary.textContent = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    if (summary) summary.textContent = `${res.items.length} ${t("mm.installed.summaryInstalled")}`;

    res.items.forEach((it, idx) => tbody.append(installedRow(it, idx + 1)));
  } catch (e) {
    if (summary) {
      summary.classList.add("is-error");
      summary.textContent = e instanceof Error ? e.message : String(e);
    }
  }
}

function installedRow(it: InstalledItem, order: number): HTMLElement {
  const tr = document.createElement("tr");

  // Name cell.
  const tdName = document.createElement("td");
  tdName.className = "mm-tcell-name";
  const badge = document.createElement("span");
  badge.className = "mm-tcell-name__ico";
  if (it.thumbnail) {
    const img = document.createElement("img");
    img.src = it.thumbnail;
    img.alt = "";
    badge.append(img);
  }
  tdName.append(badge);
  const nm = document.createElement("strong");
  nm.textContent = it.name || `Mod #${it.modId}`;
  tdName.append(nm);
  tr.append(tdName);

  // Category.
  const tdCat = document.createElement("td");
  tdCat.textContent = it.author || "—";
  tr.append(tdCat);

  // Version (mock from sourceFile or modId).
  const tdVer = document.createElement("td");
  tdVer.textContent = `v${1 + (it.modId % 4)}.${it.modId % 9}.${(it.installedAt % 7) + 0}`;
  tr.append(tdVer);

  // Status toggle.
  const tdStatus = document.createElement("td");
  const toggle = document.createElement("label");
  toggle.className = "mm-toggle" + (it.enabled ? " is-on" : "");
  toggle.innerHTML = `<input type="checkbox" ${it.enabled ? "checked" : ""} ${it.present ? "" : "disabled"} /><span class="mm-toggle__slider" aria-hidden="true"></span>`;
  const inp = toggle.querySelector<HTMLInputElement>("input")!;
  inp.addEventListener("change", async () => {
    toggle.classList.toggle("is-on", inp.checked);
    try {
      await invoke("mod_manager_toggle", { args: { mod_id: it.modId, enabled: inp.checked } });
      void loadInstalledTable();
      void refreshOverviewStats();
    } catch (e) {
      console.error("toggle failed", e);
      inp.checked = !inp.checked;
      toggle.classList.toggle("is-on", inp.checked);
    }
  });
  tdStatus.append(toggle);
  tr.append(tdStatus);

  // Load order.
  const tdOrd = document.createElement("td");
  tdOrd.textContent = String(order);
  tr.append(tdOrd);

  // Row actions (kebab).
  const tdAct = document.createElement("td");
  tdAct.className = "mm-tcell-actions";
  const gbBtn = document.createElement("button");
  gbBtn.type = "button";
  gbBtn.className = "btn btn-ghost btn-sm";
  gbBtn.textContent = "GB";
  gbBtn.title = "GameBanana";
  gbBtn.addEventListener("click", () => {
    if (it.profileUrl) void openUrl(it.profileUrl);
  });
  tdAct.append(gbBtn);
  const rm = document.createElement("button");
  rm.type = "button";
  rm.className = "btn danger-outline btn-sm";
  rm.textContent = t("mods.remove");
  rm.addEventListener("click", async () => {
    rm.disabled = true;
    try {
      await invoke("mod_manager_remove", { args: { mod_id: it.modId } });
      void loadInstalledTable();
      void refreshOverviewStats();
    } catch (e) {
      console.error("remove failed", e);
      rm.disabled = false;
    }
  });
  tdAct.append(rm);
  tr.append(tdAct);

  return tr;
}

// ---- Стат-строка Overview -----------------------------------------------

async function refreshOverviewStats(): Promise<void> {
  const elInstalled = document.getElementById("mm-stat-installed");
  const elEnabled = document.getElementById("mm-stat-enabled");
  if (!elInstalled) return;

  if (!isTauri()) {
    elInstalled.textContent = "—";
    if (elEnabled) elEnabled.textContent = "—";
    return;
  }
  try {
    const res = await invoke<InstalledResponse>("mod_manager_list_installed");
    elInstalled.textContent = String(res.items.length);
    if (elEnabled) {
      elEnabled.textContent = String(res.items.filter((m) => m.enabled).length);
    }
  } catch {
    /* ignore */
  }
}

function updateOverviewTotal(total: number): void {
  const el = document.getElementById("mm-stat-total");
  if (el) el.textContent = shortCount(total);
}

// ---- Categories / Collections (overview sidebar + full pages) -----------

const CATEGORIES: { name: string; icon: string; count: number }[] = [
  { name: "All Mods", icon: "⬚", count: 256 },
  { name: "UI", icon: "◧", count: 68 },
  { name: "Gameplay", icon: "◉", count: 72 },
  { name: "Visual", icon: "◐", count: 45 },
  { name: "Audio", icon: "◒", count: 28 },
  { name: "Performance", icon: "⚡", count: 18 },
  { name: "Utilities", icon: "◊", count: 25 },
];

const COLLECTIONS: { name: string; mods: number }[] = [
  { name: "Essentials", mods: 12 },
  { name: "Visual Overhaul", mods: 8 },
  { name: "Performance", mods: 7 },
  { name: "Quality of Life", mods: 15 },
  { name: "Audio Enhancement", mods: 6 },
];

function renderCategoriesSidebar(): void {
  const host = document.getElementById("mm-cat-list");
  if (!host) return;
  host.textContent = "";
  for (const c of CATEGORIES) host.append(catRow(c));
}

function renderCategories(): void {
  const host = document.getElementById("mm-categories-list");
  if (!host) return;
  host.textContent = "";
  for (const c of CATEGORIES) host.append(catRow(c, true));
}

function catRow(c: { name: string; icon: string; count: number }, large = false): HTMLElement {
  const li = document.createElement("li");
  li.className = "mm-cat-row" + (large ? " mm-cat-row--large" : "");
  const lab = document.createElement("span");
  lab.className = "mm-cat-row__label";
  lab.innerHTML = `<span class="mm-cat-row__ico" aria-hidden="true">${c.icon}</span><span>${escapeHtml(c.name)}</span>`;
  li.append(lab);
  const cnt = document.createElement("span");
  cnt.className = "mm-cat-row__cnt";
  cnt.textContent = String(c.count);
  li.append(cnt);
  return li;
}

function renderCollectionsSidebar(): void {
  const host = document.getElementById("mm-coll-list");
  if (!host) return;
  host.textContent = "";
  for (const c of COLLECTIONS) host.append(collRow(c));
  const elColl = document.getElementById("mm-stat-collections");
  if (elColl) elColl.textContent = String(COLLECTIONS.length);
}

function renderCollections(): void {
  const host = document.getElementById("mm-collections-list");
  if (!host) return;
  host.textContent = "";
  for (const c of COLLECTIONS) host.append(collRow(c, true));
}

function collRow(c: { name: string; mods: number }, large = false): HTMLElement {
  const li = document.createElement("li");
  li.className = "mm-coll-row" + (large ? " mm-coll-row--large" : "");
  const l = document.createElement("span");
  l.className = "mm-coll-row__label";
  l.innerHTML = `<span class="mm-coll-row__ico" aria-hidden="true">◇</span><span>${escapeHtml(c.name)}</span>`;
  li.append(l);
  const r = document.createElement("span");
  r.className = "mm-coll-row__cnt";
  r.textContent = `${c.mods} mods`;
  li.append(r);
  return li;
}

// ---- My Mods / Downloads (стабы-плейсхолдеры в духе скриншотов) ---------

const MY_MODS: { name: string; category: string; version: string; updated: string; dl: number; rating: number }[] = [
  { name: "My Crosshair Pack", category: "UI", version: "1.5.0", updated: "2 days ago", dl: 320, rating: 4.9 },
  { name: "No Fog", category: "Visual", version: "1.0.0", updated: "1 week ago", dl: 150, rating: 4.7 },
  { name: "Minimal HUD", category: "UI", version: "0.9.1", updated: "2 weeks ago", dl: 96, rating: 4.6 },
  { name: "Clean Map", category: "Visual", version: "1.2.0", updated: "3 weeks ago", dl: 74, rating: 4.5 },
  { name: "Better Sounds", category: "Audio", version: "1.1.0", updated: "1 month ago", dl: 210, rating: 4.8 },
];

function renderMyMods(): void {
  const host = document.getElementById("mm-my-list");
  const summary = document.getElementById("mm-my-summary");
  if (!host) return;
  host.textContent = "";
  for (const m of MY_MODS) {
    const li = document.createElement("li");
    li.className = "mm-my-row";
    li.innerHTML = `
      <div class="mm-my-row__thumb" aria-hidden="true">◇</div>
      <div class="mm-my-row__body">
        <strong>${escapeHtml(m.name)} <span class="mm-tag-ver">v${escapeHtml(m.version)}</span></strong>
        <span class="sub">${escapeHtml(m.category)} · ${escapeHtml(m.updated)}</span>
      </div>
      <span class="mm-my-row__rating">★ ${m.rating.toFixed(1)}</span>
      <span class="mm-my-row__dl">⤓ ${m.dl}</span>
      <button type="button" class="btn btn-ghost btn-sm" aria-label="Edit">✎</button>
      <button type="button" class="btn btn-ghost btn-sm" aria-label="More">⋮</button>
    `;
    host.append(li);
  }
  const elMy = document.getElementById("mm-stat-my");
  if (elMy) elMy.textContent = String(MY_MODS.length);
  if (summary) summary.textContent = `Showing ${MY_MODS.length} of ${MY_MODS.length} mods`;
}

function renderDownloads(): void {
  const list = document.getElementById("mm-downloads-list");
  const empty = document.getElementById("mm-downloads-empty");
  if (!list || !empty) return;
  list.textContent = "";
  empty.hidden = false;
}

// ---- App Restore --------------------------------------------------------

async function loadRestorePoints(): Promise<void> {
  const list = document.getElementById("mm-restore-list");
  const empty = document.getElementById("mm-restore-empty");
  const status = document.getElementById("mm-restore-status");
  if (!list || !empty || !status) return;
  status.textContent = "";
  list.textContent = "";
  if (!isTauri()) {
    empty.hidden = false;
    status.textContent = t("mods.tauriOnly");
    return;
  }
  try {
    const points = await invoke<RestorePoint[]>("app_restore_list");
    if (points.length === 0) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    for (const p of points) list.append(restoreRow(p));
  } catch (e) {
    status.classList.add("is-error");
    status.textContent = e instanceof Error ? e.message : String(e);
  }
}

function restoreRow(p: RestorePoint): HTMLElement {
  const li = document.createElement("li");
  li.className = "mm-restore-row";
  const label = document.createElement("div");
  label.className = "mm-restore-row__label";
  label.innerHTML = `<strong>v${escapeHtml(p.version)}</strong><span class="sub">${escapeHtml(p.label ?? "")}${p.label ? " · " : ""}${formatTs(p.createdAt)} · ${humanSize(p.sizeBytes)}</span>`;
  li.append(label);

  const actions = document.createElement("div");
  actions.className = "mm-restore-row__actions";

  const restore = document.createElement("button");
  restore.type = "button";
  restore.className = "btn btn-primary btn-sm";
  restore.textContent = t("mm.restore.restoreBtn");
  restore.addEventListener("click", () => void runRestore(p, restore));
  actions.append(restore);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn danger-outline btn-sm";
  del.textContent = t("mods.remove");
  del.addEventListener("click", () => void deleteRestore(p.id));
  actions.append(del);

  li.append(actions);
  return li;
}

async function createRestorePoint(): Promise<void> {
  const status = document.getElementById("mm-restore-status");
  if (!status) return;
  if (!isTauri()) {
    status.textContent = t("mods.tauriOnly");
    return;
  }
  status.classList.remove("is-error");
  status.textContent = t("mm.restore.creating");
  try {
    await invoke("app_restore_create", { label: null });
    status.textContent = t("mm.restore.created");
    void loadRestorePoints();
  } catch (e) {
    status.classList.add("is-error");
    status.textContent = e instanceof Error ? e.message : String(e);
  }
}

async function runRestore(p: RestorePoint, btn: HTMLButtonElement): Promise<void> {
  const confirmMsg = t("mm.restore.confirm");
  if (!confirm(confirmMsg)) return;
  const status = document.getElementById("mm-restore-status");
  btn.disabled = true;
  if (status) {
    status.classList.remove("is-error");
    status.textContent = t("mm.restore.running");
  }
  try {
    await invoke("app_restore_apply", { id: p.id });
    if (status) status.textContent = t("mm.restore.done");
    // Tauri-бэкенд перезапустит приложение.
  } catch (e) {
    if (status) {
      status.classList.add("is-error");
      status.textContent = e instanceof Error ? e.message : String(e);
    }
    btn.disabled = false;
  }
}

async function deleteRestore(id: string): Promise<void> {
  try {
    await invoke("app_restore_delete", { id });
    void loadRestorePoints();
  } catch (e) {
    console.error("restore delete failed", e);
  }
}

// ---- Helpers ------------------------------------------------------------

function describeMod(it: BrowseItem): string {
  // короткое «описание» для featured (GB subfeed не отдаёт description в тизере).
  const map: Record<string, string> = {
    Skins: "Visuals and cosmetic changes.",
    Mods: "Gameplay tweaks and enhancements.",
    Sounds: "Improved sound design and audio.",
    UI: "Interface refresh with more options.",
  };
  return map[it.category] ?? "Community mod from GameBanana.";
}

function ratingLabel(it: BrowseItem): string {
  // mock-rating из likes/views — чтобы карточка не была пустой.
  const base = 4 + ((it.likes % 9) * 0.1);
  return base.toFixed(1);
}

function shortCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function relDate(ts: number): string {
  if (!ts) return "";
  const now = Date.now() / 1000;
  const diff = now - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} hrs ago`;
  const d = Math.round(diff / 86400);
  if (d <= 6) return `${d} days ago`;
  if (d <= 30) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30)} months ago`;
}

function humanSize(bytes: number): string {
  if (!bytes) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function formatTs(ts: number): string {
  if (!ts) return "";
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return String(ts);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
