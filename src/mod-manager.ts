// Клиентская часть вкладки «Mod Manager»:
// — каталог модов с GameBanana (через Tauri-команду `mod_manager_browse`),
// — установка выбранного файла (`mod_manager_install`),
// — список установленных модов (`mod_manager_list_installed`),
// — вкл/выкл и удаление (`mod_manager_toggle`, `mod_manager_remove`).
//
// Модуль заимствует встроенные модалки: `#modal-mod-install`, `#modal-mod-remove`.

import { invoke } from "@tauri-apps/api/core";
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

type ModFile = {
  fileId: number;
  name: string;
  size: number;
  downloads: number;
  version: string;
  downloadUrl: string;
  md5: string;
  avClean: boolean;
};

type ModFilesResponse = {
  modId: number;
  files: ModFile[];
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

let bound = false;
let currentPage = 1;
let currentQuery = "";
let currentTotal = 0;
let currentPerPage = 20;

/** Единая точка входа при переключении на вкладку. */
export async function openModManagerTab(): Promise<void> {
  ensureBound();
  await refreshGameChip();
  void loadBrowse(currentPage, currentQuery);
  void loadInstalled();
}

function ensureBound(): void {
  if (bound) return;
  bound = true;

  const form = document.getElementById("mods-search-form") as HTMLFormElement | null;
  const input = document.getElementById("mods-search-input") as HTMLInputElement | null;
  const resetBtn = document.getElementById("mods-search-reset");
  const prevBtn = document.getElementById("mods-page-prev");
  const nextBtn = document.getElementById("mods-page-next");

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    currentQuery = input?.value.trim() ?? "";
    currentPage = 1;
    void loadBrowse(currentPage, currentQuery);
  });
  resetBtn?.addEventListener("click", () => {
    if (input) input.value = "";
    currentQuery = "";
    currentPage = 1;
    void loadBrowse(currentPage, currentQuery);
  });
  prevBtn?.addEventListener("click", () => {
    if (currentPage <= 1) return;
    currentPage--;
    void loadBrowse(currentPage, currentQuery);
  });
  nextBtn?.addEventListener("click", () => {
    if (currentPage >= totalPages()) return;
    currentPage++;
    void loadBrowse(currentPage, currentQuery);
  });

  // Cancel-кнопки модалок работают через общий `data-modal-dismiss`; добавим собственные handlers
  // на случай, если общий обработчик не перехватит наши id (в этом модуле — явная отмена).
  document.getElementById("modal-mod-install-cancel")?.addEventListener("click", closeInstallModal);
  document.getElementById("modal-mod-remove-cancel")?.addEventListener("click", closeRemoveModal);
}

function totalPages(): number {
  if (currentTotal <= 0) return 1;
  return Math.max(1, Math.ceil(currentTotal / currentPerPage));
}

// ---- Browse --------------------------------------------------------------

async function loadBrowse(page: number, query: string): Promise<void> {
  const grid = document.getElementById("mods-grid");
  const status = document.getElementById("mods-status");
  const pager = document.getElementById("mods-pager");
  if (!grid || !status) return;

  grid.textContent = "";
  status.textContent = t("mods.loading");
  status.className = "mods-foot";
  if (pager) pager.hidden = true;

  try {
    const res = await invoke<BrowseResponse>("mod_manager_browse", {
      args: { page, per_page: currentPerPage, query },
    });
    currentTotal = res.total;
    currentPage = res.page;
    currentPerPage = res.perPage || currentPerPage;

    if (res.items.length === 0) {
      status.textContent = t("mods.noResults");
      return;
    }
    status.textContent = "";

    for (const it of res.items) grid.append(renderBrowseCard(it));

    if (pager) {
      pager.hidden = false;
      updatePager();
    }
  } catch (e) {
    status.classList.add("is-error");
    status.textContent = e instanceof Error ? e.message : String(e);
  }
}

function updatePager(): void {
  const prev = document.getElementById("mods-page-prev") as HTMLButtonElement | null;
  const next = document.getElementById("mods-page-next") as HTMLButtonElement | null;
  const label = document.getElementById("mods-pager-label");
  if (prev) prev.disabled = currentPage <= 1;
  if (next) next.disabled = currentPage >= totalPages();
  if (label) label.textContent = `${currentPage} / ${totalPages()}`;
}

function renderBrowseCard(it: BrowseItem): HTMLElement {
  const card = document.createElement("article");
  card.className = "mod-card";

  const media = document.createElement("div");
  media.className = "mod-card__media";
  if (it.thumbnail) {
    const img = document.createElement("img");
    img.src = it.thumbnail;
    img.alt = "";
    img.loading = "lazy";
    media.append(img);
  } else {
    media.classList.add("mod-card__media--empty");
  }
  card.append(media);

  const body = document.createElement("div");
  body.className = "mod-card__body";

  const h = document.createElement("h3");
  h.className = "mod-card__title";
  h.textContent = it.name || "—";
  body.append(h);

  const meta = document.createElement("p");
  meta.className = "mod-card__meta";
  meta.textContent = [it.category, it.author].filter(Boolean).join(" · ");
  body.append(meta);

  const stats = document.createElement("p");
  stats.className = "mod-card__stats";
  stats.textContent = `♥ ${it.likes}  ·  👁 ${it.views}`;
  body.append(stats);

  const actions = document.createElement("div");
  actions.className = "mod-card__actions";

  const installBtn = document.createElement("button");
  installBtn.type = "button";
  installBtn.className = "btn btn-primary btn-sm";
  installBtn.textContent = t("mods.install");
  installBtn.disabled = !it.hasFiles;
  installBtn.addEventListener("click", () => {
    void openInstallModal(it);
  });
  actions.append(installBtn);

  const gbBtn = document.createElement("button");
  gbBtn.type = "button";
  gbBtn.className = "btn btn-ghost btn-sm";
  gbBtn.textContent = t("mods.openGb");
  gbBtn.addEventListener("click", () => {
    if (it.profileUrl) void openUrl(it.profileUrl);
  });
  actions.append(gbBtn);

  body.append(actions);
  card.append(body);
  return card;
}

// ---- Install modal -------------------------------------------------------

let currentModalTargetMod: BrowseItem | null = null;

async function openInstallModal(mod: BrowseItem): Promise<void> {
  currentModalTargetMod = mod;
  const root = document.getElementById("modal-root");
  const card = document.getElementById("modal-mod-install");
  const desc = document.getElementById("modal-mod-install-desc");
  const filesEl = document.getElementById("modal-mod-install-files");
  const status = document.getElementById("modal-mod-install-status");
  if (!root || !card || !desc || !filesEl || !status) return;

  desc.textContent = `${mod.name}${mod.author ? ` · ${mod.author}` : ""}`;
  status.textContent = t("mods.filesLoading");
  status.className = "modal-desc mods-install-status";
  filesEl.textContent = "";

  root.classList.add("is-open");
  root.setAttribute("aria-hidden", "false");
  card.classList.remove("hidden");

  try {
    const res = await invoke<ModFilesResponse>("mod_manager_mod_files", { modId: mod.id });
    if (res.files.length === 0) {
      status.textContent = t("mods.filesEmpty");
      return;
    }
    status.textContent = "";
    for (const f of res.files) {
      const li = document.createElement("li");
      li.className = "mods-file-row";

      const label = document.createElement("div");
      label.className = "mods-file-row__label";
      const name = document.createElement("strong");
      name.textContent = f.name;
      label.append(name);
      const sub = document.createElement("span");
      sub.className = "mods-file-row__sub";
      const parts: string[] = [];
      if (f.version) parts.push(`v${f.version}`);
      parts.push(humanSize(f.size));
      parts.push(`${f.downloads} DL`);
      if (f.avClean) parts.push("✓ clean");
      sub.textContent = parts.join(" · ");
      label.append(sub);
      li.append(label);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary btn-sm";
      btn.textContent = t("mods.installFile");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = t("mods.installing");
        status.classList.remove("is-error");
        status.textContent = `${t("mods.installing")} · ${humanSize(f.size)}`;
        try {
          await invoke("mod_manager_install", {
            args: {
              mod_id: mod.id,
              file_id: f.fileId,
              name: mod.name,
              author: mod.author,
              thumbnail: mod.thumbnail,
              profile_url: mod.profileUrl,
            },
          });
          status.textContent = t("mods.installDone");
          closeInstallModal();
          void loadInstalled();
        } catch (e) {
          status.classList.add("is-error");
          status.textContent = e instanceof Error ? e.message : String(e);
          btn.disabled = false;
          btn.textContent = t("mods.installFile");
        }
      });
      li.append(btn);

      filesEl.append(li);
    }
  } catch (e) {
    status.classList.add("is-error");
    status.textContent = e instanceof Error ? e.message : String(e);
  }
}

function closeInstallModal(): void {
  const root = document.getElementById("modal-root");
  const card = document.getElementById("modal-mod-install");
  if (!root || !card) return;
  card.classList.add("hidden");
  if (root.querySelectorAll(".modal-card:not(.hidden)").length === 0) {
    root.classList.remove("is-open");
    root.setAttribute("aria-hidden", "true");
  }
  currentModalTargetMod = null;
}

// ---- Remove confirmation modal ------------------------------------------

let pendingRemoveMod: InstalledItem | null = null;

function openRemoveModal(mod: InstalledItem): void {
  pendingRemoveMod = mod;
  const root = document.getElementById("modal-root");
  const card = document.getElementById("modal-mod-remove");
  const name = document.getElementById("modal-mod-remove-name");
  if (!root || !card || !name) return;
  name.textContent = mod.name || `Mod #${mod.modId}`;
  root.classList.add("is-open");
  root.setAttribute("aria-hidden", "false");
  card.classList.remove("hidden");
}

function closeRemoveModal(): void {
  const root = document.getElementById("modal-root");
  const card = document.getElementById("modal-mod-remove");
  if (!root || !card) return;
  card.classList.add("hidden");
  if (root.querySelectorAll(".modal-card:not(.hidden)").length === 0) {
    root.classList.remove("is-open");
    root.setAttribute("aria-hidden", "true");
  }
  pendingRemoveMod = null;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("modal-mod-remove-confirm")?.addEventListener("click", async () => {
    if (!pendingRemoveMod) {
      closeRemoveModal();
      return;
    }
    const mod = pendingRemoveMod;
    closeRemoveModal();
    try {
      await invoke("mod_manager_remove", { args: { mod_id: mod.modId } });
      void loadInstalled();
    } catch (e) {
      console.error("mod_manager_remove failed", e);
    }
  });
});

// ---- Installed list ------------------------------------------------------

async function loadInstalled(): Promise<void> {
  const listEl = document.getElementById("mods-installed-list");
  const emptyEl = document.getElementById("mods-installed-empty");
  const pathEl = document.getElementById("mods-installed-path");
  if (!listEl || !emptyEl) return;

  try {
    const res = await invoke<InstalledResponse>("mod_manager_list_installed");
    listEl.textContent = "";
    if (pathEl) pathEl.textContent = res.addonsPath ?? "";

    if (res.items.length === 0) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    for (const it of res.items) {
      listEl.append(renderInstalledRow(it));
    }
  } catch (e) {
    console.error("mod_manager_list_installed failed", e);
    if (pathEl) pathEl.textContent = e instanceof Error ? e.message : String(e);
  }
}

function renderInstalledRow(it: InstalledItem): HTMLElement {
  const li = document.createElement("li");
  li.className = "installed-row" + (it.enabled ? "" : " is-disabled");

  const media = document.createElement("div");
  media.className = "installed-row__media";
  if (it.thumbnail) {
    const img = document.createElement("img");
    img.src = it.thumbnail;
    img.alt = "";
    img.loading = "lazy";
    media.append(img);
  }
  li.append(media);

  const body = document.createElement("div");
  body.className = "installed-row__body";

  const name = document.createElement("strong");
  name.className = "installed-row__name";
  name.textContent = it.name || `Mod #${it.modId}`;
  body.append(name);

  const meta = document.createElement("p");
  meta.className = "installed-row__meta";
  const parts: string[] = [];
  if (it.author) parts.push(it.author);
  parts.push(`${it.filesTotal} .vpk`);
  if (!it.enabled) parts.push(t("mods.statusDisabled"));
  if (!it.present) parts.push(t("mods.statusMissing"));
  meta.textContent = parts.join(" · ");
  body.append(meta);

  li.append(body);

  const actions = document.createElement("div");
  actions.className = "installed-row__actions";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = it.enabled ? "btn btn-ghost btn-sm" : "btn btn-primary btn-sm";
  toggleBtn.textContent = it.enabled ? t("mods.disable") : t("mods.enable");
  toggleBtn.disabled = !it.present;
  toggleBtn.addEventListener("click", async () => {
    toggleBtn.disabled = true;
    try {
      await invoke("mod_manager_toggle", {
        args: { mod_id: it.modId, enabled: !it.enabled },
      });
      void loadInstalled();
    } catch (e) {
      console.error("mod_manager_toggle failed", e);
      toggleBtn.disabled = false;
    }
  });
  actions.append(toggleBtn);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn danger-outline btn-sm";
  removeBtn.textContent = t("mods.remove");
  removeBtn.addEventListener("click", () => {
    openRemoveModal(it);
  });
  actions.append(removeBtn);

  if (it.profileUrl) {
    const gbBtn = document.createElement("button");
    gbBtn.type = "button";
    gbBtn.className = "btn btn-ghost btn-sm";
    gbBtn.textContent = t("mods.openGb");
    gbBtn.addEventListener("click", () => void openUrl(it.profileUrl));
    actions.append(gbBtn);
  }

  li.append(actions);
  return li;
}

// ---- Game chip (top-right) ----------------------------------------------

async function refreshGameChip(): Promise<void> {
  const chip = document.getElementById("mods-game-chip");
  const label = chip?.querySelector<HTMLElement>(".mods-game-chip__label");
  if (!chip || !label) return;

  try {
    const res = await invoke<{ game_found: boolean; game_dir: string | null }>("autoexec_status");
    if (res.game_found) {
      chip.dataset.state = "ok";
      label.textContent = t("mods.chipFound");
      chip.title = res.game_dir ?? "";
    } else {
      chip.dataset.state = "missing";
      label.textContent = t("mods.chipMissing");
      chip.title = "";
    }
  } catch {
    chip.dataset.state = "missing";
    label.textContent = t("mods.chipMissing");
  }
}

// ---- Helpers ------------------------------------------------------------

function humanSize(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// Подсказка для не-используемой переменной (TS strict).
void currentModalTargetMod;
