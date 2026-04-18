import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { fetchReleaseNotes, type ChangelogItem } from "./release-notes";

const THEME_KEY = "dl-theme";
const VISUALS_SCRUB_POS_KEY = "dl-visuals-compare-scrub";
const TRUSTED_GH_RELEASE_URLS = [
  "https://github.com/d1n4styy/DLTweaker",
  "https://github.com/d1n4styy/DLTweakerRework",
];

const DEFAULT_DASHBOARD_SETTINGS: Record<string, unknown> = {
  fov: 90,
  brightness: 50,
  contrast: 55,
  saturation: 60,
  "visuals.esp": true,
  "visuals.enemyHighlight": "#ff3366",
  "gameplay.autoParry": false,
  "gameplay.autoSprint": true,
  "gameplay.slideEnhancer": false,
  "gameplay.bulletPrediction": false,
  "gameplay.stamina": "Balanced",
  cooldown: 25,
  "network.pingSpoof": false,
  pkt: 0,
  "network.rateLimit": "High",
  "misc.unlockConsole": false,
  "misc.removeFog": true,
  "misc.streamerMode": false,
  "misc.crosshair": "Custom Crosshair",
  "visuals.shadows": true,
};

function formatNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getDashboardRoot(): HTMLElement | null {
  return document.querySelector('[data-view-panel="dashboard"]');
}

function getVisualsRoot(): HTMLElement | null {
  return document.querySelector('[data-view-panel="visuals"]');
}

function getSettingsRoots(): HTMLElement[] {
  return [getDashboardRoot(), getVisualsRoot()].filter(Boolean) as HTMLElement[];
}

function syncSliderRowFill(row: Element): void {
  const range = row.querySelector<HTMLInputElement>('input[type="range"]');
  const num = row.querySelector<HTMLInputElement>(".num-input");
  if (!range || !num) return;
  const min = Number(range.min) || 0;
  const max = Number(range.max) || 100;
  const val = Number(range.value);
  const pct = ((val - min) / (max - min)) * 100;
  range.style.setProperty("--fill", `${pct}%`);
  num.value = range.value;
}

function bindRangeRows(): void {
  document.querySelectorAll(".slider-row").forEach((row) => {
    const range = row.querySelector<HTMLInputElement>('input[type="range"]');
    const num = row.querySelector<HTMLInputElement>(".num-input");
    if (!range || !num) return;

    const applyFromRange = () => {
      num.value = range.value;
      syncSliderRowFill(row);
    };

    const applyFromNum = () => {
      let v = Number(num.value);
      const min = Number(range.min);
      const max = Number(range.max);
      if (Number.isNaN(v)) v = min;
      v = Math.min(max, Math.max(min, v));
      num.value = String(v);
      range.value = String(v);
      syncSliderRowFill(row);
    };

    range.addEventListener("input", applyFromRange);
    num.addEventListener("change", applyFromNum);
    applyFromRange();
  });
}

function collectDashboardSettings(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const dash = getDashboardRoot();
  if (dash) {
    dash.querySelectorAll(".slider-row[data-key]").forEach((row) => {
      const key = (row as HTMLElement).dataset.key;
      const range = row.querySelector<HTMLInputElement>('input[type="range"]');
      if (key && range) out[key] = Number(range.value);
    });
  }

  getSettingsRoots().forEach((r) => {
    r.querySelectorAll<HTMLElement>("[data-setting]").forEach((el) => {
      const key = el.dataset.setting;
      if (!key) return;
      if (el.classList.contains("js-theme-toggle")) return;
      if (el instanceof HTMLInputElement && el.type === "checkbox") out[key] = el.checked;
      else if (el instanceof HTMLSelectElement) out[key] = el.value;
      else if (el instanceof HTMLInputElement && el.type === "color") out[key] = el.value;
    });
  });

  return out;
}

let isApplyingProfile = false;

function applyDashboardSettings(settings: Record<string, unknown>): void {
  const root = getDashboardRoot();
  if (!root || !settings || typeof settings !== "object") return;

  isApplyingProfile = true;
  try {
    root.querySelectorAll(".slider-row[data-key]").forEach((row) => {
      const key = (row as HTMLElement).dataset.key;
      if (key === undefined || settings[key] === undefined) return;
      const range = row.querySelector<HTMLInputElement>('input[type="range"]');
      const num = row.querySelector<HTMLInputElement>(".num-input");
      if (!range) return;
      const v = Number(settings[key]);
      if (Number.isNaN(v)) return;
      const min = Number(range.min);
      const max = Number(range.max);
      const clamped = Math.min(max, Math.max(min, v));
      range.value = String(clamped);
      if (num) num.value = String(clamped);
      syncSliderRowFill(row);
    });

    getSettingsRoots().forEach((r) => {
      r.querySelectorAll<HTMLElement>("[data-setting]").forEach((el) => {
        const key = el.dataset.setting;
        if (!key || settings[key] === undefined) return;
        if (el.classList.contains("js-theme-toggle")) return;
        if (el instanceof HTMLInputElement && el.type === "checkbox") {
          el.checked = Boolean(settings[key]);
        } else if (el instanceof HTMLSelectElement) {
          const val = String(settings[key]);
          if ([...el.options].some((o) => o.value === val)) el.value = val;
        } else if (el instanceof HTMLInputElement && el.type === "color") {
          el.value = String(settings[key]);
        }
      });
    });
  } finally {
    isApplyingProfile = false;
  }
}

function newProfileId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

type ProfileEntry = { id: string; name: string; settings: Record<string, unknown> };
type ProfileStore = { version: number; activeId: string; profiles: ProfileEntry[] };

let profileStore: ProfileStore | null = null;

async function loadProfileStoreRaw(): Promise<unknown | null> {
  if (!isTauri()) {
    try {
      const raw = localStorage.getItem("dl-profiles-store");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  return invoke<unknown | null>("profiles_load");
}

async function saveProfileStoreData(data: ProfileStore): Promise<void> {
  if (!isTauri()) {
    try {
      localStorage.setItem("dl-profiles-store", JSON.stringify(data));
    } catch {
      /* ignore */
    }
    return;
  }
  await invoke("profiles_save", { data });
}

function normalizeStore(raw: unknown): ProfileStore | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { profiles?: unknown; activeId?: unknown };
  if (!Array.isArray(o.profiles) || o.profiles.length === 0) return null;
  const profiles = o.profiles
    .filter(
      (p): p is ProfileEntry =>
        Boolean(p) &&
        typeof p === "object" &&
        typeof (p as ProfileEntry).id === "string" &&
        typeof (p as ProfileEntry).name === "string" &&
        !!(p as ProfileEntry).settings &&
        typeof (p as ProfileEntry).settings === "object",
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      settings: { ...(p.settings as Record<string, unknown>) },
    }));
  if (profiles.length === 0) return null;
  let activeId = typeof o.activeId === "string" ? o.activeId : profiles[0].id;
  if (!profiles.some((p) => p.id === activeId)) activeId = profiles[0].id;
  return { version: 1, activeId, profiles };
}

function getActiveProfile(): ProfileEntry | null {
  if (!profileStore) return null;
  return profileStore.profiles.find((p) => p.id === profileStore!.activeId) ?? null;
}

function flushCurrentUiToActiveProfile(): void {
  const active = getActiveProfile();
  if (!active) return;
  active.settings = collectDashboardSettings();
}

function touchStatUpdated(): void {
  const el = document.getElementById("stat-updated");
  if (el) el.textContent = formatNow();
}

function updateStatProfileName(): void {
  const stat = document.getElementById("stat-profile");
  const active = getActiveProfile();
  if (stat && active) stat.textContent = active.name;
}

function renderProfileSelect(): void {
  const sel = document.getElementById("profile-select") as HTMLSelectElement | null;
  if (!sel || !profileStore) return;
  const prev = profileStore.activeId;
  sel.innerHTML = "";
  profileStore.profiles.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  if (profileStore.profiles.some((p) => p.id === prev)) sel.value = prev;
  else sel.value = profileStore.activeId;
}

function renderProfilesList(): void {
  const ul = document.getElementById("profiles-list");
  if (!ul || !profileStore) return;
  ul.innerHTML = "";
  profileStore.profiles.forEach((p) => {
    const li = document.createElement("li");
    li.className = "profiles-list-item" + (p.id === profileStore!.activeId ? " is-active" : "");
    li.setAttribute("role", "listitem");

    const left = document.createElement("div");
    left.className = "profiles-list-name";
    left.textContent = p.name;
    left.title = p.name;

    const actions = document.createElement("div");
    actions.className = "profiles-list-actions";

    if (p.id === profileStore!.activeId) {
      const pill = document.createElement("span");
      pill.className = "profiles-pill";
      pill.textContent = "Active";
      actions.appendChild(pill);
    } else {
      const useBtn = document.createElement("button");
      useBtn.type = "button";
      useBtn.className = "btn btn-sm btn-ghost";
      useBtn.textContent = "Use";
      useBtn.addEventListener("click", () => void switchToProfile(p.id));
      actions.appendChild(useBtn);
    }

    li.appendChild(left);
    li.appendChild(actions);
    ul.appendChild(li);
  });
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(): void {
  if (isApplyingProfile || !profileStore) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    flushCurrentUiToActiveProfile();
    await saveProfileStoreData(profileStore!);
    touchStatUpdated();
  }, 450);
}

function bindDashboardAutosave(): void {
  const persist = () => schedulePersist();
  const dash = getDashboardRoot();
  if (dash) {
    dash.addEventListener("input", (e) => {
      if ((e.target as HTMLElement).closest(".profile-bar")) return;
      persist();
    });
    dash.addEventListener("change", (e) => {
      if ((e.target as HTMLElement).closest(".profile-bar")) return;
      persist();
    });
  }
  const vis = getVisualsRoot();
  if (vis) {
    vis.addEventListener("input", persist);
    vis.addEventListener("change", persist);
  }
}

async function switchToProfile(id: string): Promise<void> {
  if (!profileStore || !profileStore.profiles.some((p) => p.id === id)) return;
  if (id === profileStore.activeId) {
    renderProfileSelect();
    updateStatProfileName();
    return;
  }
  flushCurrentUiToActiveProfile();
  profileStore.activeId = id;
  const next = getActiveProfile();
  if (next) applyDashboardSettings(next.settings);
  await saveProfileStoreData(profileStore);
  renderProfileSelect();
  renderProfilesList();
  updateStatProfileName();
  touchStatUpdated();
}

function bindProfileSelect(): void {
  const sel = document.getElementById("profile-select");
  if (!sel) return;
  sel.addEventListener("change", () => {
    void switchToProfile((sel as HTMLSelectElement).value);
  });
}

function bindProfileToolbar(): void {
  const modalRoot = document.getElementById("modal-root");
  const modalAdd = document.getElementById("modal-add");
  const modalDelete = document.getElementById("modal-delete");
  const modalAddInput = document.getElementById("modal-add-input") as HTMLInputElement | null;
  const modalDeleteName = document.getElementById("modal-delete-name");
  let pendingDeleteId: string | null = null;

  function closeModals(): void {
    if (!modalRoot) return;
    modalRoot.classList.remove("is-open");
    modalRoot.setAttribute("aria-hidden", "true");
    modalAdd?.classList.add("hidden");
    modalDelete?.classList.add("hidden");
    pendingDeleteId = null;
  }

  function openAddModal(): void {
    if (!profileStore) return;
    if (!modalRoot || !modalAdd || !modalDelete || !modalAddInput) return;
    modalDelete.classList.add("hidden");
    modalAdd.classList.remove("hidden");
    modalRoot.classList.add("is-open");
    modalRoot.setAttribute("aria-hidden", "false");
    modalAddInput.value = "";
    requestAnimationFrame(() => {
      modalAddInput.focus({ preventScroll: true });
    });
    window.setTimeout(() => {
      if (modalRoot.classList.contains("is-open") && !modalAdd.classList.contains("hidden")) {
        modalAddInput.focus({ preventScroll: true });
      }
    }, 100);
  }

  function openDeleteModal(): void {
    if (!profileStore || profileStore.profiles.length <= 1) {
      void message("Нужен хотя бы один профиль.", { title: "Deadlock Tweaker" });
      return;
    }
    const sel = document.getElementById("profile-select") as HTMLSelectElement | null;
    const deleteId = sel?.value;
    const victim = profileStore.profiles.find((p) => p.id === deleteId);
    if (!victim || !modalRoot || !modalAdd || !modalDelete || !modalDeleteName) return;
    pendingDeleteId = deleteId ?? null;
    modalDeleteName.textContent = victim.name;
    modalAdd.classList.add("hidden");
    modalDelete.classList.remove("hidden");
    modalRoot.classList.add("is-open");
    modalRoot.setAttribute("aria-hidden", "false");
  }

  document.getElementById("profile-add")?.addEventListener("click", () => openAddModal());

  document.getElementById("modal-add-cancel")?.addEventListener("click", closeModals);

  document.getElementById("modal-add-confirm")?.addEventListener("click", async () => {
    if (!profileStore || !modalAddInput) return;
    const name = modalAddInput.value.trim();
    if (!name) {
      modalAddInput.focus();
      return;
    }
    closeModals();
    flushCurrentUiToActiveProfile();
    const settings = { ...collectDashboardSettings() };
    const id = newProfileId();
    profileStore.profiles.push({ id, name, settings });
    profileStore.activeId = id;
    await saveProfileStoreData(profileStore);
    renderProfileSelect();
    renderProfilesList();
    updateStatProfileName();
    touchStatUpdated();
  });

  modalAddInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById("modal-add-confirm")?.click();
    }
  });

  document.getElementById("profile-save")?.addEventListener("click", async () => {
    const btn = document.getElementById("profile-save") as HTMLButtonElement | null;
    if (!profileStore || !getActiveProfile() || !btn) return;
    if (btn.dataset.saveBusy === "1") return;

    const labelDefault = btn.dataset.labelDefault || btn.textContent?.trim() || "Save";
    if (!btn.dataset.labelDefault) btn.dataset.labelDefault = labelDefault;

    btn.dataset.saveBusy = "1";
    btn.classList.add("profile-save--busy");
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");

    try {
      flushCurrentUiToActiveProfile();
      await saveProfileStoreData(profileStore);
      renderProfilesList();
      updateStatProfileName();
      touchStatUpdated();

      btn.classList.remove("profile-save--busy");
      btn.classList.add("profile-save--done");
      btn.textContent = "Saved ✓";
      btn.setAttribute("aria-label", "Profile saved");

      window.setTimeout(() => {
        btn.textContent = btn.dataset.labelDefault || "Save";
        btn.classList.remove("profile-save--done");
        btn.removeAttribute("aria-label");
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
        delete btn.dataset.saveBusy;
      }, 1600);
    } catch {
      btn.classList.remove("profile-save--busy");
      btn.textContent = "Save failed";
      btn.setAttribute("aria-label", "Save failed");
      window.setTimeout(() => {
        btn.textContent = btn.dataset.labelDefault || "Save";
        btn.removeAttribute("aria-label");
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
        delete btn.dataset.saveBusy;
      }, 2000);
    }
  });

  document.getElementById("profile-delete")?.addEventListener("click", () => openDeleteModal());

  document.getElementById("modal-delete-cancel")?.addEventListener("click", closeModals);

  document.getElementById("modal-delete-confirm")?.addEventListener("click", async () => {
    const ps = profileStore;
    if (!ps || !pendingDeleteId) {
      closeModals();
      return;
    }
    const deleteId = pendingDeleteId;
    closeModals();

    const wasActive = deleteId === ps.activeId;
    ps.profiles = ps.profiles.filter((p) => p.id !== deleteId);
    if (wasActive || !ps.profiles.some((p) => p.id === ps.activeId)) {
      ps.activeId = ps.profiles[0].id;
      applyDashboardSettings(ps.profiles[0].settings);
    }
    await saveProfileStoreData(ps);
    renderProfileSelect();
    renderProfilesList();
    updateStatProfileName();
    touchStatUpdated();
  });

  modalRoot?.querySelectorAll("[data-modal-dismiss]").forEach((el) => {
    el.addEventListener("click", closeModals);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalRoot?.classList.contains("is-open")) {
      e.preventDefault();
      closeModals();
    }
  });
}

async function initProfiles(): Promise<void> {
  let raw = await loadProfileStoreRaw();
  let store = normalizeStore(raw);

  if (!store) {
    const id = newProfileId();
    const settings = collectDashboardSettings();
    store = {
      version: 1,
      activeId: id,
      profiles: [{ id, name: "Default", settings }],
    };
    await saveProfileStoreData(store);
  }

  profileStore = store;
  const active = getActiveProfile();
  if (active) applyDashboardSettings(active.settings);
  renderProfileSelect();
  renderProfilesList();
  updateStatProfileName();
}

function bindNav(): void {
  const nav = document.getElementById("main-nav");
  if (!nav) return;

  nav.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = (btn as HTMLElement).dataset.view;
      if (!view) return;

      nav.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      document.querySelectorAll("[data-view-panel]").forEach((panel) => {
        const match = (panel as HTMLElement).dataset.viewPanel === view;
        panel.classList.toggle("hidden", !match);
      });

      if (view === "profiles") renderProfilesList();
      if (view === "settings") void loadUpdatesChangelog();
    });
  });
}

let updatesChangelogLoaded = false;
let updatesChangelogLoading = false;
let updatesChangelogCache: { updateItems: ChangelogItem[]; quickPatchItems: ChangelogItem[] } | null = null;
let updatesChangelogKindBound = false;

function formatReleaseDateRu(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return String(iso);
  }
}

function simplifyReleaseBody(raw: string | null | undefined): string {
  if (raw == null) return "";
  let s = String(raw).replace(/\r\n/g, "\n");
  s = s.replace(/^---[\s\S]*?^---\s*/m, "");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  s = s.replace(/^\s*[-*]\s+/gm, "• ");
  return s.trim();
}

function bindUpdatesChangelogKindOnce(): void {
  if (updatesChangelogKindBound) return;
  const sel = document.getElementById("updates-changelog-kind");
  if (!sel) return;
  updatesChangelogKindBound = true;
  sel.addEventListener("change", () => {
    if (!updatesChangelogCache) return;
    renderUpdatesChangelogList(updatesChangelogCache, (sel as HTMLSelectElement).value);
  });
}

function renderUpdatesChangelogList(
  cache: { updateItems: ChangelogItem[]; quickPatchItems: ChangelogItem[] },
  kind: string,
): void {
  const listEl = document.getElementById("updates-changelog-list");
  const statusEl = document.getElementById("updates-changelog-status");
  if (!listEl || !statusEl) return;

  const items = kind === "quickpatch" ? cache.quickPatchItems : cache.updateItems;
  const arr = Array.isArray(items) ? items : [];

  listEl.textContent = "";
  statusEl.className = "updates-changelog-foot";

  if (arr.length === 0) {
    statusEl.textContent =
      kind === "quickpatch" ? "Нет записей quick-patch в комплекте приложения." : "Пока нет опубликованных релизов.";
    return;
  }

  statusEl.textContent = "";

  arr.forEach((it) => {
    const article = document.createElement("article");
    article.className = "updates-changelog-item";
    article.setAttribute("role", "listitem");

    const head = document.createElement("div");
    head.className = "updates-changelog-head";

    const h = document.createElement("h3");
    h.className = "updates-changelog-title";
    const title = (it.name && String(it.name).trim()) || (it.tag && String(it.tag).trim()) || "Запись";
    h.textContent = title;

    const meta = document.createElement("p");
    meta.className = "updates-changelog-meta";
    const parts = [it.tag && String(it.tag).trim(), formatReleaseDateRu(it.publishedAt)].filter(Boolean);
    meta.textContent = parts.join(" · ");

    head.append(h, meta);

    const body = document.createElement("p");
    body.className = "updates-changelog-body";
    const btxt = simplifyReleaseBody(it.body);
    body.textContent = btxt || "Нет описания.";

    article.append(head, body);

    if (it.url && TRUSTED_GH_RELEASE_URLS.some((p) => it.url.startsWith(p))) {
      const row = document.createElement("div");
      row.className = "updates-changelog-link";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-ghost btn-sm";
      b.textContent = kind === "quickpatch" ? "Папка quick-patch на GitHub" : "Открыть на GitHub";
      b.addEventListener("click", () => {
        void openUrl(it.url);
      });
      row.append(b);
      article.append(row);
    }

    listEl.append(article);
  });
}

async function loadUpdatesChangelog(): Promise<void> {
  const listEl = document.getElementById("updates-changelog-list");
  const statusEl = document.getElementById("updates-changelog-status");
  const sel = document.getElementById("updates-changelog-kind") as HTMLSelectElement | null;
  if (!listEl || !statusEl) return;
  if (updatesChangelogLoading || updatesChangelogLoaded) return;

  updatesChangelogLoading = true;
  statusEl.textContent = "Загрузка списка…";
  statusEl.className = "updates-changelog-foot";

  try {
    const res = await fetchReleaseNotes();
    if (!res.ok) {
      statusEl.classList.add("is-error");
      statusEl.textContent = res.message || "Не удалось загрузить релизы";
      updatesChangelogLoading = false;
      return;
    }

    updatesChangelogCache = { updateItems: res.items, quickPatchItems: res.quickPatchItems };

    bindUpdatesChangelogKindOnce();
    const kind = sel && sel.value ? sel.value : "updates";
    renderUpdatesChangelogList(updatesChangelogCache, kind);

    updatesChangelogLoaded = true;
  } catch (e: unknown) {
    statusEl.classList.add("is-error");
    statusEl.textContent = e instanceof Error ? e.message : "Ошибка";
  }
  updatesChangelogLoading = false;
}

const TITLEBAR_MAX_SVG =
  '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" /></svg>';
const TITLEBAR_RESTORE_SVG =
  '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true"><rect x="0.5" y="2.5" width="6" height="6" /><rect x="3.5" y="0.5" width="6" height="6" /></svg>';

async function syncTitlebarMaxIcon(): Promise<void> {
  const btn = document.getElementById("btn-max");
  if (!btn || !isTauri()) return;
  try {
    const appWindow = getCurrentWindow();
    const maxed = await appWindow.isMaximized();
    btn.innerHTML = maxed ? TITLEBAR_RESTORE_SVG : TITLEBAR_MAX_SVG;
    btn.setAttribute("aria-label", maxed ? "Восстановить размер окна" : "Развернуть на рабочую область");
  } catch {
    /* ignore */
  }
}

function bindTitlebarTauri(): void {
  if (!isTauri()) return;
  const appWindow = getCurrentWindow();

  document.getElementById("btn-min")?.addEventListener("click", () => {
    void appWindow.minimize();
  });

  const btnMax = document.getElementById("btn-max");
  if (btnMax) {
    btnMax.addEventListener("click", () => {
      void appWindow.toggleMaximize();
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => void syncTitlebarMaxIcon());
      });
    });
  }

  document.getElementById("btn-close")?.addEventListener("click", () => {
    void appWindow.close();
  });

  void syncTitlebarMaxIcon();
  let resizeT: ReturnType<typeof setTimeout>;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeT);
    resizeT = window.setTimeout(() => void syncTitlebarMaxIcon(), 120);
  });
}

function applyGameStatusUI(status: { running?: boolean; error?: boolean }): void {
  const running = Boolean(status?.running);
  const err = Boolean(status?.error);
  const dot = document.getElementById("game-detect-dot");
  const headLabel = document.getElementById("game-detect-head-label");
  const pill = document.getElementById("game-status-pill");
  const statLabel = document.getElementById("stat-game-label");
  const statPulse = document.getElementById("stat-game-pulse");
  const statWrap = document.getElementById("stat-game-status");

  if (dot) dot.classList.toggle("dot-on", running);

  if (headLabel) {
    if (err) headLabel.textContent = "Status unknown";
    else headLabel.textContent = running ? "Game detected" : "Game not running";
  }

  if (pill) {
    if (err) pill.textContent = "—";
    else pill.textContent = running ? "Running" : "Not running";
    pill.classList.toggle("game-status-pill--off", !running || err);
  }

  if (statLabel) {
    if (err) statLabel.textContent = "Unknown";
    else statLabel.textContent = running ? "Running" : "Not running";
  }

  if (statWrap) {
    statWrap.classList.toggle("stat-live", running);
    statWrap.classList.toggle("stat-idle", !running || err);
  }

  if (statPulse) {
    if (running) statPulse.removeAttribute("hidden");
    else statPulse.setAttribute("hidden", "");
  }
}

async function refreshGameStatus(): Promise<void> {
  if (!isTauri()) {
    applyGameStatusUI({ running: false, error: true });
    return;
  }
  try {
    const status = await invoke<{ running: boolean; image: string | null }>("deadlock_process_status");
    applyGameStatusUI({ running: status.running, error: false });
  } catch {
    applyGameStatusUI({ running: false, error: true });
  }
}

function startGameStatusPolling(): void {
  void refreshGameStatus();
  window.setInterval(() => {
    void refreshGameStatus();
  }, 2800);
}

function applyTheme(isLight: boolean): void {
  const root = document.documentElement;
  if (isLight) root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
  try {
    localStorage.setItem(THEME_KEY, isLight ? "light" : "dark");
  } catch {
    /* ignore */
  }
}

function syncThemeToggles(isLight: boolean): void {
  document.querySelectorAll(".js-theme-toggle").forEach((el) => {
    (el as HTMLInputElement).checked = isLight;
  });
}

function initTheme(): void {
  const stored = localStorage.getItem(THEME_KEY);
  const isLight = stored === "light";
  applyTheme(isLight);
  syncThemeToggles(isLight);
}

function bindThemeToggle(): void {
  document.querySelectorAll(".js-theme-toggle").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const on = (toggle as HTMLInputElement).checked;
      applyTheme(on);
      syncThemeToggles(on);
    });
  });
}

function hiDpiVariantPath(baseSrc: string): string {
  const i = baseSrc.lastIndexOf(".");
  if (i <= 0) return `${baseSrc}@2x`;
  return `${baseSrc.slice(0, i)}@2x${baseSrc.slice(i)}`;
}

const DEFAULT_COMPARE_OFF = "/Screens/ShadowsOFF.png";
const DEFAULT_COMPARE_ON = "/Screens/ShadowsON.png";
const FALLBACK_COMPARE = "/assets/logo.png";

function probeImage(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

async function resolveExistingImage(candidates: string[]): Promise<string | null> {
  for (const src of candidates) {
    if (!src) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await probeImage(src)) return src;
  }
  return null;
}

function expandCompareCandidates(primary: string): string[] {
  const p = (primary || "").trim();
  if (!p) return [];
  const out = [p];
  const dot = p.lastIndexOf(".");
  const stem = dot > 0 ? p.slice(0, dot) : p;
  out.push(`${stem}.jpg`, `${stem}.jpeg`, `${stem}.png`, `${stem}.jpb`);
  out.push(`${stem}.JPG`, `${stem}.JPEG`, `${stem}.PNG`, `${stem}.JPB`);
  return [...new Set(out)];
}

async function applyVisualsCompareSrcFromDataset(): Promise<void> {
  const root = document.getElementById("visuals-compare-scrub");
  if (!root) return;
  const offRequested = (root.dataset.compareOff || DEFAULT_COMPARE_OFF).trim();
  const onRequested = (root.dataset.compareOn || DEFAULT_COMPARE_ON).trim();
  const off = await resolveExistingImage([...expandCompareCandidates(offRequested), FALLBACK_COMPARE]);
  const on = await resolveExistingImage([...expandCompareCandidates(onRequested), off || FALLBACK_COMPARE]);
  const base = root.querySelector<HTMLImageElement>(".visuals-scrub__base");
  const top = root.querySelector<HTMLImageElement>(".visuals-scrub__top");
  if (base && off) base.src = off;
  if (top && on) top.src = on;
}

async function initVisualsCompareAsset(): Promise<void> {
  await applyVisualsCompareSrcFromDataset();

  function applySrcsetIfHiDpi(img: HTMLImageElement | null): void {
    if (!img) return;
    const baseSrc = img.getAttribute("src");
    if (!baseSrc) return;
    const hidpi = hiDpiVariantPath(baseSrc);
    const probe = new Image();
    probe.onload = () => {
      img.setAttribute("srcset", `${baseSrc} 1x, ${hidpi} 2x`);
    };
    probe.onerror = () => {};
    probe.src = hidpi;
  }

  const root = document.getElementById("visuals-compare-scrub");
  if (!root) return;
  applySrcsetIfHiDpi(root.querySelector(".visuals-scrub__base"));
  applySrcsetIfHiDpi(root.querySelector(".visuals-scrub__top"));
}

function bindVisualsCompareScrubber(): void {
  const root = document.getElementById("visuals-compare-scrub");
  const range = document.getElementById("visuals-scrub-range") as HTMLInputElement | null;
  const pill = document.getElementById("visuals-scrub-pill");
  if (!root || !range) return;
  const scrubRoot = root;
  const scrubRange = range;

  function setPill(n: number): void {
    if (!pill) return;
    if (n < 50) {
      pill.textContent = "ON";
      pill.className = "visuals-scrub__pill visuals-scrub__pill--on";
    } else if (n > 50) {
      pill.textContent = "OFF";
      pill.className = "visuals-scrub__pill visuals-scrub__pill--off";
    } else {
      pill.textContent = "ON · OFF";
      pill.className = "visuals-scrub__pill visuals-scrub__pill--mid";
    }
  }

  function applyPct(raw: string | number): void {
    const n = Math.min(100, Math.max(0, Number(raw) || 0));
    scrubRoot.style.setProperty("--split", `${n}%`);
    setPill(n);
    const hint =
      n < 50
        ? "Seam left of center — preview reads ON"
        : n > 50
          ? "Seam right of center — preview reads OFF"
          : "Seam centered";
    scrubRange.setAttribute("aria-valuetext", `${Math.round(n)}%. ${hint}`);
  }

  let stored = 50;
  try {
    const t = localStorage.getItem(VISUALS_SCRUB_POS_KEY);
    if (t != null && t !== "") stored = Math.min(100, Math.max(0, Number(t)));
  } catch {
    /* ignore */
  }
  scrubRange.value = String(stored);
  applyPct(stored);

  scrubRange.addEventListener("input", () => applyPct(scrubRange.value));
  scrubRange.addEventListener("change", () => {
    try {
      localStorage.setItem(VISUALS_SCRUB_POS_KEY, String(Math.round(Number(scrubRange.value) * 10) / 10));
    } catch {
      /* ignore */
    }
  });
}

function bindQuickActions(): void {
  const buttons = [...document.querySelectorAll(".card-actions .action-stack .btn")];
  const [applyBtn, discardBtn, reloadBtn, resetBtn] = buttons;

  applyBtn?.addEventListener("click", async () => {
    if (!profileStore) return;
    flushCurrentUiToActiveProfile();
    await saveProfileStoreData(profileStore);
    renderProfilesList();
    updateStatProfileName();
    touchStatUpdated();
    void message("Изменения применены к активному профилю и сохранены на диск.", {
      title: "Deadlock Tweaker",
    });
  });

  discardBtn?.addEventListener("click", () => {
    const active = getActiveProfile();
    if (active) applyDashboardSettings(active.settings);
    void message("Несохранённые правки сброшены к последнему сохранённому состоянию профиля.", {
      title: "Deadlock Tweaker",
    });
  });

  reloadBtn?.addEventListener("click", () => {
    void message(
      "Конфигурация игры: в этой сборке (Tauri) нет привязки к файлам Deadlock на диске — это заглушка.",
      { title: "Deadlock Tweaker" },
    );
  });

  resetBtn?.addEventListener("click", async () => {
    const ok = await ask("Сбросить все значения дашборда и вкладки Visuals к заводским?", {
      title: "Deadlock Tweaker",
      kind: "warning",
    });
    if (!ok) return;
    applyDashboardSettings({ ...DEFAULT_DASHBOARD_SETTINGS });
    if (profileStore) {
      flushCurrentUiToActiveProfile();
      await saveProfileStoreData(profileStore);
      renderProfilesList();
      updateStatProfileName();
      touchStatUpdated();
    }
  });

  document.querySelector(".card-misc .field-row.inline .btn.btn-ghost")?.addEventListener("click", () => {
    void message("Редактор прицела пока не подключён.", { title: "Deadlock Tweaker" });
  });
}

function bindSettingsUpdates(): void {
  const verEl = document.getElementById("settings-app-version");
  const btnCheck = document.getElementById("settings-check-updates") as HTMLButtonElement | null;
  const btnDl = document.getElementById("settings-download-updates") as HTMLButtonElement | null;
  const msg = document.getElementById("settings-update-msg");
  if (!verEl || !btnCheck || !btnDl || !msg) return;
  const statusMsg = msg;

  if (isTauri()) {
    void invoke<string>("app_version").then(
      (v) => {
        verEl.textContent = v || "—";
      },
      () => {
        verEl.textContent = "—";
      },
    );
  } else {
    verEl.textContent = "—";
  }

  let pendingAppUpdate: Update | null = null;

  function setMsg(text: string, tone: "" | "ok" | "warn" | "err"): void {
    statusMsg.textContent = text;
    statusMsg.className = "settings-update-msg";
    if (tone === "ok") statusMsg.classList.add("is-ok");
    else if (tone === "warn") statusMsg.classList.add("is-warn");
    else if (tone === "err") statusMsg.classList.add("is-error");
  }

  btnCheck.addEventListener("click", async () => {
    pendingAppUpdate = null;
    setMsg("Проверка…", "");
    btnCheck.disabled = true;
    btnDl.disabled = true;
    try {
      const parts: string[] = [];
      let appOk = false;
      if (isTauri()) {
        try {
          const update = await check();
          if (update) {
            pendingAppUpdate = update;
            parts.push(`Приложение: доступна версия ${update.version}.`);
            appOk = true;
          } else {
            parts.push("Приложение: обновлений нет или канал недоступен.");
          }
        } catch (e) {
          parts.push(`Приложение: ${e instanceof Error ? e.message : "ошибка проверки"}.`);
        }

        try {
          const qp = await invoke<{ ok?: boolean; manifest?: Record<string, unknown> }>("quick_patch_check_only");
          if (qp?.ok && qp.manifest && typeof qp.manifest === "object") {
            const id = qp.manifest.id != null ? String(qp.manifest.id) : "";
            parts.push(id ? `Quick-patch: манифест «${id}» загружен.` : "Quick-patch: манифест загружен.");
          } else {
            parts.push("Quick-patch: не удалось получить манифест.");
          }
        } catch (e) {
          parts.push(`Quick-patch: ${e instanceof Error ? e.message : "ошибка"}.`);
        }
      } else {
        parts.push("Проверка обновлений доступна только в десктопной сборке Tauri.");
      }

      btnDl.disabled = !pendingAppUpdate;
      const tone: "ok" | "warn" | "err" | "" = appOk ? "ok" : parts.some((p) => p.includes("ошибка")) ? "warn" : "ok";
      setMsg(parts.join(" "), tone);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Ошибка", "err");
      btnDl.disabled = true;
    }
    btnCheck.disabled = false;
  });

  btnDl.addEventListener("click", async () => {
    if (!pendingAppUpdate || !isTauri()) return;
    setMsg("Скачивание и установка…", "");
    btnDl.disabled = true;
    btnCheck.disabled = true;
    try {
      await pendingAppUpdate.downloadAndInstall();
      setMsg("Перезапуск…", "ok");
      await relaunch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Ошибка установки", "err");
      btnDl.disabled = false;
    } finally {
      btnCheck.disabled = false;
    }
  });
}

async function initAppVersionLabels(): Promise<void> {
  const infoDd = document.getElementById("info-version-dd");
  if (!infoDd || !isTauri()) return;
  try {
    infoDd.textContent = await invoke<string>("app_version");
  } catch {
    infoDd.textContent = "—";
  }
}

function applyNativeWindowFrameClass(): void {
  if (typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)) {
    document.documentElement.classList.add("dl-native-win-frame");
  }
}

export async function initDeadlockApp(): Promise<void> {
  const statUpdated = document.getElementById("stat-updated");
  if (statUpdated) statUpdated.textContent = formatNow();

  applyNativeWindowFrameClass();
  if (!document.documentElement.classList.contains("dl-native-win-frame")) {
    bindTitlebarTauri();
  }

  initTheme();
  bindThemeToggle();
  bindRangeRows();
  bindNav();
  bindQuickActions();
  void initVisualsCompareAsset();
  bindVisualsCompareScrubber();
  bindSettingsUpdates();
  startGameStatusPolling();

  await initProfiles();
  bindProfileSelect();
  bindProfileToolbar();
  bindDashboardAutosave();
  touchStatUpdated();
  void initAppVersionLabels();
}
