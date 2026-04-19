import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { fetchReleaseNotes, type ChangelogItem } from "./release-notes";
import { renderUpdateTimeline, type UpdateTimelineDeps, type UpdateTimelineKind } from "./updates-panel";
import { applyAll as applyI18n, getLang, onLangChange, setLang, t, type Lang } from "./i18n";

const VISUALS_SCRUB_POS_KEY = "dl-visuals-compare-scrub";
const TRUSTED_GH_RELEASE_URLS = ["https://github.com/d1n4styy/DLTweakerRework"];

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

/** Сравнение скриншотов Visuals: тяжёлая проверка файлов — только при первом заходе на вкладку. */
let visualsCompareAssetsPromise: Promise<void> | null = null;

function ensureVisualsCompareAssetsLoaded(): void {
  if (visualsCompareAssetsPromise) return;
  visualsCompareAssetsPromise = initVisualsCompareAsset();
}

function bindNav(): void {
  const nav = document.getElementById("main-nav");
  if (!nav) return;

  const navButtons = [...nav.querySelectorAll<HTMLElement>(".nav-item")];
  const viewPanels = [...document.querySelectorAll<HTMLElement>("[data-view-panel]")];

  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      if (!view) return;

      navButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      for (const panel of viewPanels) {
        const match = panel.dataset.viewPanel === view;
        panel.classList.toggle("hidden", !match);
      }

      if (view === "profiles") renderProfilesList();
      if (view === "settings") void loadUpdatesChangelog();
      if (view === "visuals") ensureVisualsCompareAssetsLoaded();
    });
  });
}

let updatesChangelogLoaded = false;
let updatesChangelogLoading = false;
let updatesChangelogCache: { updateItems: ChangelogItem[]; quickPatchItems: ChangelogItem[] } | null = null;
let updatesChangelogKindBound = false;
let updatesFilterTabsBound = false;
let updatesTimelineFilter: "all" | "important" = "all";

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
  const sel = document.getElementById("updates-changelog-kind") as HTMLSelectElement | null;
  if (!sel) return;
  updatesChangelogKindBound = true;
  sel.addEventListener("change", () => {
    if (!updatesChangelogCache) return;
    renderUpdatesChangelogList(updatesChangelogCache, sel.value);
  });
  enhanceCustomSelect(sel);
}

/**
 * Превращает <select> в кастомный визуальный selector (подменяет UI, но native <select>
 * остаётся в DOM как «model»: значение/события сохраняются — внешний код продолжает работать).
 */
function enhanceCustomSelect(native: HTMLSelectElement): void {
  if (native.dataset.csReady === "1") return;
  native.dataset.csReady = "1";

  const wrap = document.createElement("div");
  wrap.className = "cs-wrap";
  wrap.dataset.for = native.id || "";
  // Перенос модификаторов размера: .full / .grow / .updates-changelog-select
  if (native.classList.contains("full")) wrap.classList.add("cs-wrap--full");
  if (native.classList.contains("grow")) wrap.classList.add("cs-wrap--grow");
  if (native.classList.contains("updates-changelog-select")) wrap.classList.add("cs-wrap--updates");

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "cs-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  if (native.id) trigger.id = native.id + "-trigger";

  const labelSpan = document.createElement("span");
  labelSpan.className = "cs-label";
  trigger.append(labelSpan);

  const caret = document.createElement("span");
  caret.className = "cs-caret";
  caret.setAttribute("aria-hidden", "true");
  trigger.append(caret);

  const menu = document.createElement("ul");
  menu.className = "cs-menu";
  menu.setAttribute("role", "listbox");
  menu.tabIndex = -1;
  menu.hidden = true;

  let optionEls: HTMLLIElement[] = [];
  const buildMenu = () => {
    menu.textContent = "";
    optionEls = [];
    for (const opt of Array.from(native.options)) {
      const li = document.createElement("li");
      li.className = "cs-option";
      li.setAttribute("role", "option");
      li.dataset.value = opt.value;
      li.textContent = opt.textContent || opt.value;
      if (opt.disabled) li.setAttribute("aria-disabled", "true");
      if (opt.value === native.value) li.classList.add("is-selected");
      li.addEventListener("click", () => {
        if (opt.disabled) return;
        if (native.value !== opt.value) {
          native.value = opt.value;
          native.dispatchEvent(new Event("change", { bubbles: true }));
        }
        syncFromNative();
        close();
        trigger.focus();
      });
      menu.append(li);
      optionEls.push(li);
    }
  };

  const syncFromNative = () => {
    const cur = native.options[native.selectedIndex];
    labelSpan.textContent = cur ? (cur.textContent || cur.value) : "";
    optionEls.forEach((li) => {
      li.classList.toggle("is-selected", li.dataset.value === native.value);
    });
  };

  // Слежение за внешними изменениями options (renderProfileSelect и т.п.)
  const mo = new MutationObserver(() => {
    buildMenu();
    syncFromNative();
  });
  mo.observe(native, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "selected"] });

  let isOpen = false;
  const open = () => {
    if (isOpen) return;
    isOpen = true;
    menu.hidden = false;
    wrap.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    const sel = menu.querySelector<HTMLLIElement>(".cs-option.is-selected") || optionEls[0];
    sel?.focus?.();
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onKey, true);
  };
  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    menu.hidden = true;
    wrap.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("keydown", onKey, true);
  };

  function onDocDown(e: MouseEvent): void {
    if (!wrap.contains(e.target as Node)) close();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      trigger.focus();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const idx = optionEls.findIndex((li) => li.dataset.value === native.value);
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const next = optionEls[(idx + dir + optionEls.length) % optionEls.length];
      if (next) {
        next.click();
      }
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      const el = document.activeElement as HTMLElement | null;
      if (el && el.classList.contains("cs-option")) {
        e.preventDefault();
        el.click();
      }
    }
  }

  trigger.addEventListener("click", () => (isOpen ? close() : open()));
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  });

  // Внешние изменения native.value (на всякий случай — синхронизируемся)
  native.addEventListener("change", syncFromNative);

  // Скрываем native, не убирая его из DOM (иначе сломается state и существующие listeners)
  native.classList.add("cs-native");
  native.tabIndex = -1;
  native.setAttribute("aria-hidden", "true");

  // Вставляем wrapper рядом с native
  native.parentNode?.insertBefore(wrap, native);
  wrap.append(trigger, menu, native);

  buildMenu();
  syncFromNative();
}

function bindUpdatesFilterTabsOnce(): void {
  if (updatesFilterTabsBound) return;
  const all = document.getElementById("updates-filter-all");
  const imp = document.getElementById("updates-filter-important");
  if (!all || !imp) return;
  updatesFilterTabsBound = true;
  const apply = (f: "all" | "important") => {
    updatesTimelineFilter = f;
    all.classList.toggle("is-active", f === "all");
    imp.classList.toggle("is-active", f === "important");
    all.setAttribute("aria-selected", f === "all" ? "true" : "false");
    imp.setAttribute("aria-selected", f === "important" ? "true" : "false");
    if (!updatesChangelogCache) return;
    const sel = document.getElementById("updates-changelog-kind") as HTMLSelectElement | null;
    renderUpdatesChangelogList(updatesChangelogCache, sel?.value || "updates");
  };
  all.addEventListener("click", () => apply("all"));
  imp.addEventListener("click", () => apply("important"));
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
    statusEl.textContent = kind === "quickpatch" ? t("updates.foot.emptyQuickpatch") : t("updates.foot.emptyReleases");
    return;
  }

  statusEl.textContent = "";

  const tk: UpdateTimelineKind = kind === "quickpatch" ? "quickpatch" : "updates";
  const deps: UpdateTimelineDeps = {
    kind: tk,
    simplifyBody: simplifyReleaseBody,
    formatDate: formatReleaseDateRu,
    trustedUrlPrefixes: TRUSTED_GH_RELEASE_URLS,
    onOpenUrl: (url) => {
      void openUrl(url);
    },
  };

  renderUpdateTimeline(listEl, arr, updatesTimelineFilter, deps);
}

async function loadUpdatesChangelog(): Promise<void> {
  const listEl = document.getElementById("updates-changelog-list");
  const statusEl = document.getElementById("updates-changelog-status");
  const sel = document.getElementById("updates-changelog-kind") as HTMLSelectElement | null;
  if (!listEl || !statusEl) return;
  if (updatesChangelogLoading || updatesChangelogLoaded) return;

  updatesChangelogLoading = true;
  statusEl.textContent = t("updates.foot.loading");
  statusEl.className = "updates-changelog-foot";

  try {
    const res = await fetchReleaseNotes();
    if (!res.ok) {
      statusEl.classList.add("is-error");
      statusEl.textContent = res.message || t("updates.foot.fetchFail");
      updatesChangelogLoading = false;
      return;
    }

    updatesChangelogCache = { updateItems: res.items, quickPatchItems: res.quickPatchItems };

    bindUpdatesChangelogKindOnce();
    bindUpdatesFilterTabsOnce();
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

type GameStatusState = "running" | "notRunning" | "error";

let lastGameStatusState: GameStatusState = "error";

function applyGameStatusUI(status: { running?: boolean; error?: boolean }): void {
  const running = Boolean(status?.running);
  const err = Boolean(status?.error);
  lastGameStatusState = err ? "error" : running ? "running" : "notRunning";
  const dot = document.getElementById("game-detect-dot");
  const headLabel = document.getElementById("game-detect-head-label");
  const pill = document.getElementById("game-status-pill");
  const statLabel = document.getElementById("stat-game-label");
  const statPulse = document.getElementById("stat-game-pulse");
  const statWrap = document.getElementById("stat-game-status");

  if (dot) dot.classList.toggle("dot-on", running);

  if (headLabel) {
    headLabel.textContent =
      lastGameStatusState === "error"
        ? t("game.checking")
        : running
          ? t("sidebar.gameDetected")
          : t("game.notRunning");
  }

  if (pill) {
    pill.textContent =
      lastGameStatusState === "error" ? "—" : running ? t("game.running") : t("game.notRunning");
    pill.classList.toggle("game-status-pill--off", !running || err);
  }

  if (statLabel) {
    statLabel.textContent =
      lastGameStatusState === "error" ? "—" : running ? t("game.running") : t("game.notRunning");
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

function startGameStatusPolling(opts?: { skipImmediate?: boolean }): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const intervalMs = () => (document.hidden ? 30_000 : 2800);

  const schedule = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    timer = window.setTimeout(() => {
      timer = null;
      void refreshGameStatus().finally(schedule);
    }, intervalMs());
  };

  document.addEventListener("visibilitychange", () => {
    schedule();
  });

  if (!opts?.skipImmediate) void refreshGameStatus();
  schedule();
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
  // Compare layout: слева — ON (base), справа — OFF (top, отрисовывается поверх правее --split)
  if (base && on) base.src = on;
  if (top && off) top.src = off;
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
    // Layout: слева ON, справа OFF. Меньшая позиция шва → больше OFF (top перекрывает).
    if (n < 50) {
      pill.textContent = "OFF";
      pill.className = "visuals-scrub__pill visuals-scrub__pill--off";
    } else if (n > 50) {
      pill.textContent = "ON";
      pill.className = "visuals-scrub__pill visuals-scrub__pill--on";
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
        ? "Seam left of center — preview reads OFF"
        : n > 50
          ? "Seam right of center — preview reads ON"
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

  let scrubRaf = 0;
  scrubRange.addEventListener("input", () => {
    if (scrubRaf) return;
    scrubRaf = window.requestAnimationFrame(() => {
      scrubRaf = 0;
      applyPct(scrubRange.value);
    });
  });
  scrubRange.addEventListener("change", () => {
    if (scrubRaf) {
      window.cancelAnimationFrame(scrubRaf);
      scrubRaf = 0;
    }
    applyPct(scrubRange.value);
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

type QuickPatchInvokeResult = {
  ok?: boolean;
  code?: string;
  message?: string;
  id?: string;
  description?: string;
  minV?: string;
  maxV?: string;
};

type UiStartupSnapshot = {
  version: string;
  game: { running: boolean; image?: string | null };
  quickPatchCss: string;
};

function applyVersionLabels(version: string | null | undefined): void {
  const v = version && String(version).trim() ? String(version).trim() : "—";
  const s = document.getElementById("settings-app-version");
  if (s) s.textContent = v;
  const i = document.getElementById("info-version-dd");
  if (i) i.textContent = v;
}

function applyQuickPatchCssText(css: string): void {
  const existing = document.getElementById("dl-quick-patch-css");
  const trimmed = css.trim();
  if (!trimmed) {
    existing?.remove();
    return;
  }
  const el = existing ?? document.createElement("style");
  if (!existing) {
    el.id = "dl-quick-patch-css";
    document.head.appendChild(el);
  }
  el.textContent = css;
}

async function tryUiStartupSnapshot(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const snap = await invoke<UiStartupSnapshot>("ui_startup_snapshot");
    applyVersionLabels(snap.version);
    applyGameStatusUI({ running: Boolean(snap.game?.running), error: false });
    applyQuickPatchCssText(snap.quickPatchCss ?? "");
    return true;
  } catch {
    return false;
  }
}

async function refreshQuickPatchCss(): Promise<void> {
  if (!isTauri()) return;
  try {
    const css = await invoke<string>("quick_patch_get_css");
    applyQuickPatchCssText(css);
  } catch {
    /* ignore */
  }
}

async function initQuickPatchStyles(): Promise<void> {
  await refreshQuickPatchCss();
}

function bindSettingsUpdates(): void {
  const verEl = document.getElementById("settings-app-version");
  const btnCheck = document.getElementById("settings-check-updates") as HTMLButtonElement | null;
  const btnDl = document.getElementById("settings-download-updates") as HTMLButtonElement | null;
  const msg = document.getElementById("settings-update-msg");
  if (!verEl || !btnCheck || !btnDl || !msg) return;
  const statusMsg = msg;

  const badge = document.getElementById("updates-status-badge");
  const arrow = document.getElementById("updates-ver-arrow");
  const targetWrap = document.getElementById("updates-ver-target");
  const targetStrong = document.getElementById("updates-target-version");
  const progressRoot = document.getElementById("updates-download-progress");
  const progressFill = document.getElementById("updates-download-progress-fill");
  const progressLabel = document.getElementById("updates-download-progress-label");

  let pendingAppUpdate: Update | null = null;
  let pendingUpdateKind: "none" | "nsis" | "qp" = "none";

  type HeroState = "idle" | "checking" | "uptodate" | "available" | "qp" | "error" | "downloading";

  function resetDownloadProgress(): void {
    if (progressFill) progressFill.style.width = "0%";
    if (progressLabel) progressLabel.textContent = "";
    if (progressRoot) progressRoot.hidden = true;
  }

  function showDownloadProgress(on: boolean): void {
    if (progressRoot) progressRoot.hidden = !on;
  }

  let lastHeroState: HeroState = "idle";
  let lastHeroTarget: string | null | undefined;

  function syncUpdatesHero(state: HeroState, targetVersion?: string | null): void {
    if (!badge) return;
    lastHeroState = state;
    lastHeroTarget = targetVersion;
    badge.dataset.state = state;
    const keys: Record<HeroState, string> = {
      idle: "updates.statusIdle",
      checking: "updates.statusChecking",
      uptodate: "updates.statusUptodate",
      available: "updates.statusAvailable",
      qp: "updates.statusQp",
      error: "updates.statusError",
      downloading: "updates.statusDownloading",
    };
    badge.textContent = t(keys[state]);
    if (state === "downloading") return;
    const showTarget = state === "available" && Boolean(targetVersion);
    if (arrow) arrow.hidden = !showTarget;
    if (targetWrap) targetWrap.hidden = !showTarget;
    if (targetStrong && targetVersion) targetStrong.textContent = targetVersion;
  }

  // Перерисовать badge при смене языка
  onLangChange(() => {
    if (!badge) return;
    syncUpdatesHero(lastHeroState, lastHeroTarget);
  });

  function setMsg(text: string, tone: "" | "ok" | "warn" | "err"): void {
    statusMsg.textContent = text;
    statusMsg.className = "updates-hero-detail settings-update-msg";
    if (tone === "ok") statusMsg.classList.add("is-ok");
    else if (tone === "warn") statusMsg.classList.add("is-warn");
    else if (tone === "err") statusMsg.classList.add("is-error");
  }

  syncUpdatesHero("idle");

  btnCheck.addEventListener("click", async () => {
    pendingAppUpdate = null;
    pendingUpdateKind = "none";
    resetDownloadProgress();
    syncUpdatesHero("checking");
    setMsg(t("updates.msg.checking"), "");
    btnCheck.disabled = true;
    btnDl.disabled = true;
    try {
      const parts: string[] = [];
      let rQp: QuickPatchInvokeResult | null = null;

      if (isTauri()) {
        try {
          const update = await check();
          if (update) {
            pendingAppUpdate = update;
            parts.push(`Приложение: доступна версия ${update.version}.`);
          } else {
            parts.push("Приложение: новой версии нет — установлена последняя опубликованная сборка.");
          }
        } catch (e) {
          parts.push(`Приложение: ${e instanceof Error ? e.message : "ошибка проверки"}.`);
        }

        try {
          rQp = await invoke<QuickPatchInvokeResult>("quick_patch_check_only");
          if (!rQp || rQp.ok !== true) {
            parts.push(`Quick-patch: ${rQp?.message || "ошибка проверки"}.`);
          } else if (rQp.code === "available") {
            const d = rQp.description ? ` — ${rQp.description}` : "";
            parts.push(`Quick-patch: доступен «${rQp.id ?? ""}»${d}.`);
          } else if (rQp.code === "uptodate") {
            parts.push("Quick-patch: уже актуален.");
          } else if (rQp.code === "range") {
            parts.push(rQp.message || "Quick-patch: не для этой версии приложения.");
          } else if (rQp.code === "noop") {
            parts.push("Quick-patch: в манифесте нет файлов для загрузки.");
          } else {
            parts.push(rQp.message || "Quick-patch: готово.");
          }
        } catch (e) {
          parts.push(`Quick-patch: ${e instanceof Error ? e.message : "ошибка"}.`);
        }

        if (pendingAppUpdate) pendingUpdateKind = "nsis";
        else if (rQp && rQp.ok === true && rQp.code === "available") pendingUpdateKind = "qp";

        if (pendingAppUpdate && rQp && rQp.ok === true && rQp.code === "available") {
          parts.push("Сначала скачается версия приложения; quick-patch подтянется при следующем запуске.");
        }

        btnDl.disabled = pendingUpdateKind === "none";

        let tone: "" | "ok" | "warn" | "err" = "ok";
        if (pendingUpdateKind !== "none") {
          tone = "ok";
        } else if (parts.some((p) => p.startsWith("Приложение:") && p.includes("ошибка"))) {
          tone = rQp && rQp.ok === true && rQp.code === "available" ? "ok" : "warn";
        } else if (rQp && rQp.ok === false) {
          tone = "warn";
        }

        if (pendingUpdateKind === "nsis" && pendingAppUpdate) {
          syncUpdatesHero("available", pendingAppUpdate.version);
        } else if (pendingUpdateKind === "qp") {
          syncUpdatesHero("qp");
        } else if (parts.some((p) => p.includes("ошибка"))) {
          syncUpdatesHero("error");
        } else {
          syncUpdatesHero("uptodate");
        }
        setMsg(parts.join(" "), tone);
      } else {
        parts.push(t("updates.msg.restartingDesktopOnly"));
        btnDl.disabled = true;
        syncUpdatesHero("idle");
        setMsg(parts.join(" "), "warn");
      }
    } catch (e) {
      syncUpdatesHero("error");
      setMsg(e instanceof Error ? e.message : t("updates.msg.error"), "err");
      btnDl.disabled = true;
      pendingUpdateKind = "none";
    }
    btnCheck.disabled = false;
  });

  btnDl.addEventListener("click", async () => {
    if (!isTauri() || pendingUpdateKind === "none") return;

    if (pendingUpdateKind === "nsis" && pendingAppUpdate) {
      setMsg(t("updates.msg.downloadInstall"), "");
      showDownloadProgress(true);
      syncUpdatesHero("downloading");
      btnDl.disabled = true;
      btnCheck.disabled = true;
      let downloaded = 0;
      let total = 0;
      try {
        await pendingAppUpdate.downloadAndInstall((ev) => {
          if (ev.event === "Started") {
            downloaded = 0;
            total = ev.data.contentLength ?? 0;
            if (progressLabel) progressLabel.textContent = t("updates.msg.dlProgressLabel");
          } else if (ev.event === "Progress") {
            downloaded += ev.data.chunkLength;
            if (total > 0 && progressFill) {
              const pct = Math.min(100, Math.round((downloaded / total) * 100));
              progressFill.style.width = `${pct}%`;
              if (progressLabel) progressLabel.textContent = `${pct}%`;
            }
          } else if (ev.event === "Finished") {
            if (progressFill) progressFill.style.width = "100%";
            if (progressLabel) progressLabel.textContent = t("updates.msg.dlInstalling");
          }
        });
        setMsg(t("updates.msg.relaunch"), "ok");
        await relaunch();
      } catch (e) {
        resetDownloadProgress();
        if (pendingAppUpdate) syncUpdatesHero("available", pendingAppUpdate.version);
        else syncUpdatesHero("uptodate");
        setMsg(e instanceof Error ? e.message : t("updates.msg.installError"), "err");
        btnDl.disabled = false;
      } finally {
        btnCheck.disabled = false;
      }
      return;
    }

    if (pendingUpdateKind === "qp") {
      setMsg(t("updates.msg.qpFetching"), "");
      btnDl.disabled = true;
      btnCheck.disabled = true;
      try {
        const r = await invoke<QuickPatchInvokeResult>("quick_patch_apply", { silent: false });
        pendingUpdateKind = "none";
        if (!r || r.ok !== true) {
          setMsg(r?.message || t("updates.msg.qpApplyFail"), "err");
          btnDl.disabled = false;
        } else if (r.code === "applied") {
          setMsg(r.message || t("updates.msg.qpAppliedDefault"), "ok");
          btnDl.disabled = true;
          await refreshQuickPatchCss();
        } else if (r.code === "uptodate" || r.code === "noop") {
          setMsg(r.message || t("updates.msg.done"), "ok");
          btnDl.disabled = true;
        } else {
          setMsg(r.message || t("updates.msg.done"), "warn");
          btnDl.disabled = false;
        }
      } catch (e) {
        pendingUpdateKind = "none";
        setMsg(e instanceof Error ? e.message : t("updates.msg.error"), "err");
        btnDl.disabled = false;
      } finally {
        btnCheck.disabled = false;
      }
    }
  });
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

  bindRangeRows();
  bindNav();
  bindQuickActions();
  bindVisualsCompareScrubber();

  const snapshotOk = await tryUiStartupSnapshot();
  if (!snapshotOk) {
    if (isTauri()) {
      void refreshGameStatus();
      void initQuickPatchStyles();
      void invoke<string>("app_version").then(
        (v) => applyVersionLabels(v),
        () => applyVersionLabels(null),
      );
    } else {
      applyVersionLabels(null);
    }
  }
  startGameStatusPolling({ skipImmediate: snapshotOk });

  bindSettingsUpdates();

  await initProfiles();
  bindProfileSelect();
  bindProfileToolbar();
  bindDashboardAutosave();
  touchStatUpdated();
  enhanceAllSelects();
  bindLangSwitch();
  // При смене языка — обновить игру/options селектов и др.
  onLangChange(() => {
    applyI18n();
    applyGameStatusUI({
      running: lastGameStatusState === "running",
      error: lastGameStatusState === "error",
    });
    refreshLocalizedSelectOptions();
  });
}

function bindLangSwitch(): void {
  const root = document.querySelector<HTMLElement>(".lang-switch");
  if (!root) return;
  const buttons = root.querySelectorAll<HTMLButtonElement>(".lang-switch__btn");
  const sync = () => {
    const cur = getLang();
    buttons.forEach((b) => {
      const on = b.dataset.lang === cur;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  };
  sync();
  buttons.forEach((b) => {
    b.addEventListener("click", () => {
      const lang = (b.dataset.lang as Lang) || "en";
      setLang(lang);
      sync();
    });
  });
}

/** Обновить тексты <option> в селектах, которые имеют data-i18n значения. */
function refreshLocalizedSelectOptions(): void {
  document.querySelectorAll<HTMLOptionElement>("option[data-i18n]").forEach((opt) => {
    const key = opt.dataset.i18n;
    if (key) opt.textContent = t(key);
  });
  // Trigger re-render of custom select menus (MutationObserver слушает атрибуты)
  document.querySelectorAll<HTMLSelectElement>("select[data-cs-ready='1']").forEach((sel) => {
    sel.setAttribute("data-i18n-rev", String(Date.now()));
  });
}

/** Применить кастомный UI ко всем <select> на странице (один раз). */
function enhanceAllSelects(): void {
  const selects = document.querySelectorAll<HTMLSelectElement>("select");
  selects.forEach((sel) => enhanceCustomSelect(sel));
}
