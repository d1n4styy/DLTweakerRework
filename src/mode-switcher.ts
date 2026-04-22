// Переключатель двух режимов приложения: Tweaker и Mod Manager.
// Каждый режим имеет свой логотип, свою навигацию и свой набор view-секций.
// Переключение — через `data-mode` на `<html>` (body), CSS-анимации делают остальное.

import { t, onLangChange } from "./i18n";

export type AppMode = "tweaker" | "mods";

const STORAGE_KEY = "dl-mode";

let currentMode: AppMode = "tweaker";
// Скролл-позиция каждого режима, чтобы не терялась при переключении.
const scrollPositions: Record<AppMode, number> = { tweaker: 0, mods: 0 };
const activeTweakerView: { ref: string } = { ref: "dashboard" };
const activeMmView: { ref: string } = { ref: "mm-overview" };

export function getMode(): AppMode {
  return currentMode;
}

export function initModeSwitcher(onModeActivated: (mode: AppMode) => void): void {
  // Восстановление ранее выбранного режима.
  const saved = readSavedMode();
  applyMode(saved, { immediate: true });

  const btn = document.getElementById("mode-switch-btn");
  btn?.addEventListener("click", () => {
    const next: AppMode = currentMode === "tweaker" ? "mods" : "tweaker";
    void switchMode(next, onModeActivated);
  });

  // Tweaker nav уже имеет обработчики (bindNav), добавляем для MM.
  const mmNav = document.getElementById("nav-mm");
  mmNav?.querySelectorAll<HTMLElement>(".nav-item[data-mm-view]").forEach((b) => {
    b.addEventListener("click", () => {
      const target = b.dataset.mmView;
      if (!target) return;
      activeMmView.ref = target;
      activateMmView(target);
    });
  });

  // Перекрёстные ссылки из Overview («View All» → categories/collections/overview).
  document.querySelectorAll<HTMLElement>("[data-mm-view-link]").forEach((b) => {
    b.addEventListener("click", () => {
      const target = b.dataset.mmViewLink;
      if (!target) return;
      if (target === "overview") {
        activateMmView("mm-overview");
      } else if (target === "categories") {
        activateMmView("mm-categories");
      } else if (target === "collections") {
        activateMmView("mm-collections");
      }
      // sync left-nav active state
      document.querySelectorAll<HTMLElement>("#nav-mm .nav-item[data-mm-view]").forEach((x) => {
        const match = x.dataset.mmView === activeMmView.ref.replace(/^mm-/, "");
        x.classList.toggle("active", match);
      });
    });
  });

  // Отслеживаем активную Tweaker-вкладку, чтобы восстановить её при возврате в режим.
  const tweakerNav = document.getElementById("nav-tweaker");
  tweakerNav?.querySelectorAll<HTMLElement>(".nav-item[data-view]").forEach((b) => {
    b.addEventListener("click", () => {
      const v = b.dataset.view;
      if (v) activeTweakerView.ref = v;
    });
  });

  // При смене языка обновляем подпись кнопки переключателя.
  onLangChange(() => syncSwitchLabel());
  syncSwitchLabel();

  // Сохраняем скролл при любом уходе из режима.
  const main = document.querySelector<HTMLElement>(".main");
  main?.addEventListener("scroll", () => {
    scrollPositions[currentMode] = main.scrollTop;
  });
}

async function switchMode(next: AppMode, onModeActivated: (mode: AppMode) => void): Promise<void> {
  if (next === currentMode) return;
  // Ставим промежуточный класс, CSS делает cross-fade контента + ротацию логотипов.
  const root = document.documentElement;
  root.classList.add("mode-switching");
  root.classList.add(`mode-switching--to-${next}`);

  // Сохраняем скролл.
  const main = document.querySelector<HTMLElement>(".main");
  if (main) scrollPositions[currentMode] = main.scrollTop;

  applyMode(next);

  // Даём CSS-анимации прогнаться, затем вызываем колбэк.
  await new Promise((r) => window.setTimeout(r, 380));
  root.classList.remove("mode-switching", "mode-switching--to-tweaker", "mode-switching--to-mods");

  // Восстанавливаем скролл.
  if (main) main.scrollTop = scrollPositions[next] ?? 0;

  onModeActivated(next);
}

function applyMode(mode: AppMode, opts: { immediate?: boolean } = {}): void {
  currentMode = mode;
  document.documentElement.dataset.mode = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
  syncSwitchLabel();

  // Отметим активным логотип и nav.
  document.getElementById("brand-logo-tweaker")?.classList.toggle("is-active", mode === "tweaker");
  document.getElementById("brand-logo-mm")?.classList.toggle("is-active", mode === "mods");
  document.getElementById("nav-tweaker")?.classList.toggle("is-active", mode === "tweaker");
  document.getElementById("nav-mm")?.classList.toggle("is-active", mode === "mods");

  if (mode === "tweaker") {
    activateTweakerView(activeTweakerView.ref);
  } else {
    activateMmView(activeMmView.ref);
  }

  // Для мгновенного применения при старте — не включаем `mode-switching`.
  if (opts.immediate) {
    document.documentElement.classList.remove("mode-switching", "mode-switching--to-tweaker", "mode-switching--to-mods");
  }
}

function activateTweakerView(view: string): void {
  const panels = document.querySelectorAll<HTMLElement>("[data-view-panel]");
  panels.forEach((p) => {
    const key = p.dataset.viewPanel ?? "";
    const isTweakerPanel = !key.startsWith("mm-");
    p.classList.toggle("hidden", !(isTweakerPanel && key === view));
  });
  document.querySelectorAll<HTMLElement>("#nav-tweaker .nav-item[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
}

function activateMmView(view: string): void {
  // Принимаем и "overview", и "mm-overview" — нормализуем к panel-ключу.
  const panelKey = view.startsWith("mm-") ? view : `mm-${view}`;
  const panels = document.querySelectorAll<HTMLElement>("[data-view-panel]");
  panels.forEach((p) => {
    const key = p.dataset.viewPanel ?? "";
    const isMmPanel = key.startsWith("mm-");
    p.classList.toggle("hidden", !(isMmPanel && key === panelKey));
  });
  activeMmView.ref = panelKey;
  document.querySelectorAll<HTMLElement>("#nav-mm .nav-item[data-mm-view]").forEach((b) => {
    const match = `mm-${b.dataset.mmView}` === panelKey;
    b.classList.toggle("active", match);
  });
  document.dispatchEvent(new CustomEvent("mm-view:change", { detail: { view: panelKey } }));
}

function readSavedMode(): AppMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "mods" || v === "tweaker") return v;
  } catch {
    /* ignore */
  }
  return "tweaker";
}

function syncSwitchLabel(): void {
  const label = document.getElementById("mode-switch-btn-label");
  if (!label) return;
  label.textContent = currentMode === "tweaker" ? t("mode.switchToMm") : t("mode.switchToTweaker");
}
