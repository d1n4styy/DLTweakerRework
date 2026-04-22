/**
 * Минимальная i18n-система: словарь EN (база) + RU (UI-переводы).
 * Имена фич приложения (Auto Parry, ESP, Slide Enhancer, FOV и т.п.) НЕ переводятся.
 */

export type Lang = "en" | "ru";

type Dict = Record<string, string>;

const EN: Dict = {
  // Sidebar / nav
  "nav.dashboard": "Dashboard",
  "nav.visuals": "Visuals",
  "nav.gameplay": "Gameplay",
  "nav.network": "Network",
  "nav.hotkeys": "Hotkeys",
  "nav.misc": "Misc",
  "nav.profiles": "Profiles",
  "nav.updates": "Updates",

  "mode.switchToMm": "Switch to Mod Manager",
  "mode.switchToTweaker": "Switch to Tweaker",

  "mm.nav.overview": "Overview",
  "mm.nav.installed": "Installed",
  "mm.nav.myMods": "My Mods",
  "mm.nav.categories": "Categories",
  "mm.nav.collections": "Collections",
  "mm.nav.downloads": "Downloads",
  "mm.nav.settings": "Settings",

  "mm.overview.title": "Overview",
  "mm.overview.sub": "Browse and manage mods for Deadlock.",
  "mm.overview.searchPlaceholder": "Search mods…",
  "mm.overview.installMod": "Install Mod",

  "mm.stat.total": "Total Mods",
  "mm.stat.totalSub": "available",
  "mm.stat.installed": "Installed Mods",
  "mm.stat.installedSub": "enabled:",
  "mm.stat.myMods": "My Mods",
  "mm.stat.myModsSub": "created",
  "mm.stat.collections": "Collections",
  "mm.stat.collectionsSub": "collections",
  "mm.stat.loadOrder": "Load Order",
  "mm.stat.loadOrderVal": "Custom",
  "mm.stat.loadOrderSub": "priority",

  "mm.featured.title": "Featured Mods",
  "mm.recent.title": "Recently Updated",
  "mm.categories.title": "Categories",
  "mm.collections.title": "Collections",
  "mm.viewAll": "View All",
  "mm.installed": "Installed",

  "mm.dropzone.primary": "Drag and drop mod files here",
  "mm.dropzone.secondary": "or click to browse",

  "mm.installed.title": "Installed",
  "mm.installed.sub": "Manage your installed mods.",
  "mm.installed.searchPlaceholder": "Search installed mods…",
  "mm.installed.loadOrder": "Load Order",
  "mm.installed.filterLabel": "All",
  "mm.installed.summaryInstalled": "mods installed",

  "mm.table.name": "Name",
  "mm.table.category": "Category",
  "mm.table.version": "Version",
  "mm.table.status": "Status",
  "mm.table.loadOrder": "Load Order",

  "mm.myMods.title": "My Mods",
  "mm.myMods.sub": "Manage and update your created mods.",
  "mm.myMods.create": "Create Mod",

  "mm.categoriesPage.title": "Categories",
  "mm.categoriesPage.sub": "Browse mods by category.",
  "mm.collectionsPage.title": "Collections",
  "mm.collectionsPage.sub": "Curated bundles of mods.",
  "mm.downloads.title": "Downloads",
  "mm.downloads.sub": "In-progress and recent downloads.",
  "mm.downloads.empty": "No active downloads.",

  "mm.settingsPage.title": "Mod Manager · Settings",
  "mm.settingsPage.sub": "Integration paths and application safety.",

  "mm.restore.title": "App Restore",
  "mm.restore.sub": "Snapshots of the app state before updates. Keeps the last 3 points.",
  "mm.restore.create": "Create Restore Point",
  "mm.restore.creating": "Creating snapshot…",
  "mm.restore.created": "Restore point created.",
  "mm.restore.empty": "No restore points yet.",
  "mm.restore.restoreBtn": "Restore",
  "mm.restore.running": "Applying restore point…",
  "mm.restore.done": "Applied. The app will restart.",
  "mm.restore.confirm": "This will revert the app to a previous version. Continue?",

  "mods.tauriOnly": "Available only in the desktop build.",
  "sidebar.gameDetected": "GAME DETECTED",
  "game.checking": "Checking…",
  "game.running": "Running",
  "game.notRunning": "Not running",
  "lang.en": "English",
  "lang.ru": "Russian",

  // Dashboard top
  "dashboard.title": "Dashboard",
  "dashboard.sub": "Welcome back — manage your tweaks from one place.",

  // Profile bar
  "profile.add": "Add",
  "profile.save": "Save",
  "profile.delete": "Delete",
  "profile.saveBusy": "Saving…",
  "profile.saveDone": "Saved",

  // Stat row
  "stat.activeProfile": "Active Profile",
  "stat.defaultProfile": "Default Profile",
  "stat.gameStatus": "Game Status",
  "stat.protection": "Protection",
  "stat.protectionEnabled": "Enabled",
  "stat.findConfig": "Find Config",
  "stat.configChecking": "Checking…",
  "stat.configFound": "Found",
  "stat.configMissing": "Missing",
  "stat.configUnavailable": "No game found",
  "stat.lastUpdated": "Last Updated",

  // Card titles (titles only — feature names below are kept in EN)
  "card.visuals": "Visuals",
  "card.gameplay": "Gameplay",
  "card.network": "Network",
  "card.misc": "Misc",
  "card.quickActions": "Quick Actions",
  "card.enemyHighlight": "Enemy Highlight",
  "card.staminaHelper": "Stamina Helper",
  "card.rateLimit": "Rate Limit",

  // Quick Actions buttons
  "btn.applyChanges": "Apply Changes",
  "btn.discardChanges": "Discard Changes",
  "btn.reloadGameConfig": "Reload Game Config",
  "btn.resetAllSettings": "Reset All Settings",
  "btn.edit": "Edit",
  "btn.createConfig": "Create autoexec.cfg",
  "btn.creatingConfig": "Creating…",
  "toast.configCreatedTitle": "Deadlock Tweaker",
  "toast.configCreated": "autoexec.cfg created at",
  "toast.configCreateFailed": "Failed to create autoexec.cfg",
  "toast.configNoGame": "Deadlock installation was not found via Steam. Launch the game once through Steam and try again.",

  // Visuals tab
  "visuals.title": "Visuals",
  "visuals.sub": "Fine-tune rendering and overlays.",
  "visuals.tweaks": "Visuals Tweaks",
  "visuals.tweaksDesc": "Rendering and clarity options for Deadlock.",
  "visuals.compare": "Compare",
  "visuals.compareAria": "Open OFF vs ON screenshot comparison",
  "compare.subtitle": "Compare visual difference",
  "compare.closeAria": "Close comparison",
  "compare.dragAria": "Compare OFF and ON: drag horizontally",

  // Placeholder views
  "placeholder.gameplay.title": "Gameplay",
  "placeholder.gameplay.sub": "Combat and movement assists.",
  "placeholder.network.title": "Network",
  "placeholder.network.sub": "Latency and traffic tweaks.",
  "placeholder.hotkeys.title": "Hotkeys",
  "placeholder.hotkeys.sub": "Bind actions to keys.",
  "placeholder.misc.title": "Misc",
  "placeholder.misc.sub": "Extra options.",
  "placeholder.body": "Placeholder — wire your logic to these sections.",
  "placeholder.bodyShort": "Placeholder.",

  // Profiles view
  "profiles.title": "Profiles",
  "profiles.sub": "Profiles are stored as JSON in %AppData%/DeadlockTweakerRework/profiles.json (or platform equivalent on macOS/Linux).",
  "profiles.cardTitle": "Your profiles",
  "profiles.cardHint": "Stored in the app data folder. Switch the active profile from the dashboard or here.",
  "profiles.useBtn": "Use",
  "profiles.deleteBtn": "Delete",
  "profiles.activePill": "Active",

  // Updates tab
  "updates.title": "Updates",
  "updates.checkBtn": "Check for updates",
  "updates.downloadBtn": "Download and install",
  "updates.versionCurrent": "Current",
  "updates.versionTarget": "New",
  "updates.timelineTitle": "Changelog",
  "updates.timelineSub": "App releases and Quick-patch entries from GitHub (local copy in bundle).",
  "updates.releasesSub": "App releases from GitHub (local copy in bundle).",
  "updates.quickpatchTitle": "Quick-patch history",
  "updates.quickpatchSub": "Overlay patches delivered between full releases.",
  "updates.filterAll": "All",
  "updates.filterImportant": "Important",
  "updates.kindLabel": "Type",
  "updates.kindReleases": "App releases",
  "updates.kindQuickpatch": "Quick-patch",
  "updates.statusIdle": "Ready to check",
  "updates.statusChecking": "Checking channel…",
  "updates.statusUptodate": "Latest version installed",
  "updates.statusAvailable": "App update available",
  "updates.statusQp": "Quick-patch available",
  "updates.statusError": "Check error",
  "updates.statusDownloading": "Downloading and installing…",
  "updates.msg.checking": "Checking…",
  "updates.msg.relaunch": "Restarting…",
  "updates.msg.installError": "Install failed",
  "updates.msg.error": "Error",
  "updates.msg.restartingDesktopOnly": "Update checks are only available in the desktop (Tauri) build.",
  "updates.msg.qpFetching": "Fetching quick-patch…",
  "updates.msg.qpApplyFail": "Patch could not be applied",
  "updates.msg.qpAppliedDefault": "Patch downloaded and applied.",
  "updates.msg.done": "Done",
  "updates.msg.downloadInstall": "Downloading and installing…",
  "updates.msg.dlProgressLabel": "Downloading…",
  "updates.msg.dlInstalling": "Installing…",
  "updates.msg.appAvailable": "Update Release",
  "updates.msg.qpAvailable": "Update Quick-Patch",
  "updates.msg.allUpToDate": "You're on the latest version.",
  "updates.msg.appCheckFail": "Release check failed",
  "updates.msg.qpCheckFail": "Quick-patch check failed",
  "updates.foot.loading": "Loading list…",
  "updates.foot.emptyReleases": "No releases yet.",
  "updates.foot.emptyQuickpatch": "No quick-patch entries bundled with the app.",
  "updates.foot.fetchFail": "Failed to load releases",
  "updates.timeline.openRelease": "Release on GitHub",
  "updates.timeline.openQp": "Quick-patch on GitHub",
  "updates.timeline.newBadge": "NEW",
  "updates.timeline.activeBadge": "ACTIVE",
  "updates.timeline.noDescription": "No description.",
  "updates.section.functionality": "Functionality",
  "updates.section.interface": "Interface",

  // Mod Manager
  "mods.title": "Mod Manager",
  "mods.sub": "Browse GameBanana mods for Deadlock and manage installed ones.",
  "mods.chipChecking": "Locating Deadlock…",
  "mods.chipFound": "Deadlock found",
  "mods.chipMissing": "Game not found",
  "mods.browseTitle": "GameBanana",
  "mods.searchPlaceholder": "Search mods…",
  "mods.searchBtn": "Search",
  "mods.searchReset": "Reset",
  "mods.pagePrev": "← Prev",
  "mods.pageNext": "Next →",
  "mods.installedTitle": "Installed mods",
  "mods.installedEmpty": "No mods installed.",
  "mods.loading": "Loading catalog…",
  "mods.noResults": "Nothing matched.",
  "mods.install": "Install",
  "mods.installFile": "Install",
  "mods.installing": "Installing…",
  "mods.installDone": "Installed.",
  "mods.filesLoading": "Fetching files…",
  "mods.filesEmpty": "This mod has no active files.",
  "mods.openGb": "GameBanana",
  "mods.enable": "Enable",
  "mods.disable": "Disable",
  "mods.remove": "Remove",
  "mods.statusDisabled": "disabled",
  "mods.statusMissing": "missing on disk",
  "mods.installTitle": "Install mod",
  "mods.removeTitle": "Remove mod",
  "mods.removeBody": " will be deleted from the addons folder. Uninstalled files cannot be recovered.",

  // Modals (profile add / delete)
  "modal.addTitle": "New profile",
  "modal.addDesc": "Set a profile name and add it to the list.",
  "modal.addLabel": "Name",
  "modal.addPlaceholder": "e.g., Competitive",
  "modal.cancel": "Cancel",
  "modal.add": "Add",
  "modal.deleteTitle": "Delete profile",
  "modal.deleteDescA": "The profile ",
  "modal.deleteDescB": " will be deleted. This cannot be undone.",
  "modal.delete": "Delete",
};

const RU: Dict = {
  "nav.dashboard": "Dashboard",
  "nav.visuals": "Visuals",
  "nav.gameplay": "Gameplay",
  "nav.network": "Network",
  "nav.hotkeys": "Hotkeys",
  "nav.misc": "Misc",
  "nav.profiles": "Профили",
  "nav.updates": "Обновления",

  "mode.switchToMm": "Перейти в Mod Manager",
  "mode.switchToTweaker": "Перейти в Tweaker",

  "mm.nav.overview": "Обзор",
  "mm.nav.installed": "Установленные",
  "mm.nav.myMods": "Мои моды",
  "mm.nav.categories": "Категории",
  "mm.nav.collections": "Коллекции",
  "mm.nav.downloads": "Загрузки",
  "mm.nav.settings": "Настройки",

  "mm.overview.title": "Обзор",
  "mm.overview.sub": "Каталог и управление модами Deadlock.",
  "mm.overview.searchPlaceholder": "Поиск модов…",
  "mm.overview.installMod": "Установить мод",

  "mm.stat.total": "Всего модов",
  "mm.stat.totalSub": "доступно",
  "mm.stat.installed": "Установлено",
  "mm.stat.installedSub": "включено:",
  "mm.stat.myMods": "Мои моды",
  "mm.stat.myModsSub": "создано",
  "mm.stat.collections": "Коллекции",
  "mm.stat.collectionsSub": "коллекций",
  "mm.stat.loadOrder": "Порядок",
  "mm.stat.loadOrderVal": "Свой",
  "mm.stat.loadOrderSub": "приоритет",

  "mm.featured.title": "Избранные моды",
  "mm.recent.title": "Недавно обновлены",
  "mm.categories.title": "Категории",
  "mm.collections.title": "Коллекции",
  "mm.viewAll": "Показать все",
  "mm.installed": "Установлено",

  "mm.dropzone.primary": "Перетащите сюда файлы мода",
  "mm.dropzone.secondary": "или кликните для выбора",

  "mm.installed.title": "Установленные",
  "mm.installed.sub": "Управление установленными модами.",
  "mm.installed.searchPlaceholder": "Поиск среди установленных…",
  "mm.installed.loadOrder": "Порядок",
  "mm.installed.filterLabel": "Все",
  "mm.installed.summaryInstalled": "модов установлено",

  "mm.table.name": "Название",
  "mm.table.category": "Категория",
  "mm.table.version": "Версия",
  "mm.table.status": "Статус",
  "mm.table.loadOrder": "Порядок",

  "mm.myMods.title": "Мои моды",
  "mm.myMods.sub": "Управляйте и обновляйте свои моды.",
  "mm.myMods.create": "Создать мод",

  "mm.categoriesPage.title": "Категории",
  "mm.categoriesPage.sub": "Каталог модов по категориям.",
  "mm.collectionsPage.title": "Коллекции",
  "mm.collectionsPage.sub": "Подборки модов.",
  "mm.downloads.title": "Загрузки",
  "mm.downloads.sub": "Активные и недавние загрузки.",
  "mm.downloads.empty": "Активных загрузок нет.",

  "mm.settingsPage.title": "Mod Manager · Настройки",
  "mm.settingsPage.sub": "Пути интеграции и безопасность приложения.",

  "mm.restore.title": "App Restore",
  "mm.restore.sub": "Снимки состояния приложения перед обновлениями. Хранится 3 последних точки.",
  "mm.restore.create": "Создать точку восстановления",
  "mm.restore.creating": "Создаём снимок…",
  "mm.restore.created": "Точка восстановления создана.",
  "mm.restore.empty": "Точек восстановления пока нет.",
  "mm.restore.restoreBtn": "Восстановить",
  "mm.restore.running": "Применяем точку восстановления…",
  "mm.restore.done": "Готово. Приложение перезапустится.",
  "mm.restore.confirm": "Приложение будет откачено к предыдущей версии. Продолжить?",

  "mods.tauriOnly": "Доступно только в десктоп-сборке.",
  "sidebar.gameDetected": "ИГРА ОБНАРУЖЕНА",
  "game.checking": "Проверка…",
  "game.running": "Запущена",
  "game.notRunning": "Не запущена",
  "lang.en": "English",
  "lang.ru": "Русский",

  "dashboard.title": "Dashboard",
  "dashboard.sub": "С возвращением — управляйте настройками в одном месте.",

  "profile.add": "Добавить",
  "profile.save": "Сохранить",
  "profile.delete": "Удалить",
  "profile.saveBusy": "Сохранение…",
  "profile.saveDone": "Сохранено",

  "stat.activeProfile": "Активный профиль",
  "stat.defaultProfile": "Профиль по умолчанию",
  "stat.gameStatus": "Статус игры",
  "stat.protection": "Защита",
  "stat.protectionEnabled": "Включена",
  "stat.findConfig": "Поиск конфига",
  "stat.configChecking": "Проверка…",
  "stat.configFound": "Найден",
  "stat.configMissing": "Не найден",
  "stat.configUnavailable": "Игра не найдена",
  "stat.lastUpdated": "Обновлено",

  // Названия секций оставляем в EN — это «фичи»
  "card.visuals": "Visuals",
  "card.gameplay": "Gameplay",
  "card.network": "Network",
  "card.misc": "Misc",
  "card.quickActions": "Быстрые действия",
  "card.enemyHighlight": "Enemy Highlight",
  "card.staminaHelper": "Stamina Helper",
  "card.rateLimit": "Rate Limit",

  "btn.applyChanges": "Применить",
  "btn.discardChanges": "Отменить изменения",
  "btn.reloadGameConfig": "Перезагрузить конфиг игры",
  "btn.resetAllSettings": "Сбросить все настройки",
  "btn.edit": "Изменить",
  "btn.createConfig": "Создать autoexec.cfg",
  "btn.creatingConfig": "Создание…",
  "toast.configCreatedTitle": "Deadlock Tweaker",
  "toast.configCreated": "autoexec.cfg создан по пути",
  "toast.configCreateFailed": "Не удалось создать autoexec.cfg",
  "toast.configNoGame": "Установка Deadlock не найдена через Steam. Запустите игру из Steam хотя бы раз и повторите попытку.",

  "visuals.title": "Visuals",
  "visuals.sub": "Тонкая настройка отрисовки и оверлеев.",
  "visuals.tweaks": "Visuals Tweaks",
  "visuals.tweaksDesc": "Параметры отрисовки и чёткости для Deadlock.",
  "visuals.compare": "Сравнить",
  "visuals.compareAria": "Открыть сравнение OFF vs ON",
  "compare.subtitle": "Сравните визуальную разницу",
  "compare.closeAria": "Закрыть сравнение",
  "compare.dragAria": "Сравнение OFF и ON: тяните горизонтально",

  "placeholder.gameplay.title": "Gameplay",
  "placeholder.gameplay.sub": "Боевые и движенческие помощники.",
  "placeholder.network.title": "Network",
  "placeholder.network.sub": "Сетевые настройки и латентность.",
  "placeholder.hotkeys.title": "Hotkeys",
  "placeholder.hotkeys.sub": "Привязка действий к клавишам.",
  "placeholder.misc.title": "Misc",
  "placeholder.misc.sub": "Дополнительные опции.",
  "placeholder.body": "Заглушка — здесь будет ваш функционал.",
  "placeholder.bodyShort": "Заглушка.",

  "profiles.title": "Профили",
  "profiles.sub": "Профили хранятся как JSON в %AppData%/DeadlockTweakerRework/profiles.json (или аналог на macOS/Linux).",
  "profiles.cardTitle": "Ваши профили",
  "profiles.cardHint": "Хранится в каталоге данных приложения. Сменить активный профиль можно здесь или на дашборде.",
  "profiles.useBtn": "Активировать",
  "profiles.deleteBtn": "Удалить",
  "profiles.activePill": "Активный",

  "updates.title": "Обновления",
  "updates.checkBtn": "Проверить обновления",
  "updates.downloadBtn": "Скачать и установить",
  "updates.versionCurrent": "Текущая",
  "updates.versionTarget": "Новая",
  "updates.timelineTitle": "Журнал изменений",
  "updates.timelineSub": "Релизы приложения и заметки Quick-patch с GitHub (локальный комплект).",
  "updates.releasesSub": "Релизы приложения с GitHub (локальный комплект).",
  "updates.quickpatchTitle": "История quick-patch",
  "updates.quickpatchSub": "Оверлейные правки между полными релизами.",
  "updates.filterAll": "Все",
  "updates.filterImportant": "Важные",
  "updates.kindLabel": "Тип",
  "updates.kindReleases": "Релизы приложения",
  "updates.kindQuickpatch": "Quick-patch",
  "updates.statusIdle": "Готово к проверке",
  "updates.statusChecking": "Проверка канала…",
  "updates.statusUptodate": "Установлена последняя версия",
  "updates.statusAvailable": "Доступно обновление приложения",
  "updates.statusQp": "Доступен quick-patch",
  "updates.statusError": "Ошибка проверки",
  "updates.statusDownloading": "Загрузка и установка…",
  "updates.msg.checking": "Проверка…",
  "updates.msg.relaunch": "Перезапуск…",
  "updates.msg.installError": "Ошибка установки",
  "updates.msg.error": "Ошибка",
  "updates.msg.restartingDesktopOnly": "Проверка обновлений доступна только в десктопной сборке Tauri.",
  "updates.msg.qpFetching": "Загрузка quick-patch…",
  "updates.msg.qpApplyFail": "Не удалось применить патч",
  "updates.msg.qpAppliedDefault": "Патч загружен и применён.",
  "updates.msg.done": "Готово",
  "updates.msg.downloadInstall": "Скачивание и установка…",
  "updates.msg.dlProgressLabel": "Загрузка…",
  "updates.msg.dlInstalling": "Установка…",
  "updates.msg.appAvailable": "Обновление Release",
  "updates.msg.qpAvailable": "Обновление Quick-Patch",
  "updates.msg.allUpToDate": "Установлена последняя версия.",
  "updates.msg.appCheckFail": "Ошибка проверки релиза",
  "updates.msg.qpCheckFail": "Ошибка проверки quick-patch",
  "updates.foot.loading": "Загрузка списка…",
  "updates.foot.emptyReleases": "Пока нет опубликованных релизов.",
  "updates.foot.emptyQuickpatch": "Нет записей quick-patch в комплекте приложения.",
  "updates.foot.fetchFail": "Не удалось загрузить релизы",
  "updates.timeline.openRelease": "Релиз на GitHub",
  "updates.timeline.openQp": "Quick-patch на GitHub",
  "updates.section.functionality": "Функционал",
  "updates.section.interface": "Интерфейс",
  "updates.timeline.newBadge": "NEW",
  "updates.timeline.activeBadge": "ACTIVE",
  "updates.timeline.noDescription": "Нет описания.",

  "mods.title": "Менеджер модов",
  "mods.sub": "Каталог модов Deadlock с GameBanana и управление установленными.",
  "mods.chipChecking": "Ищем Deadlock…",
  "mods.chipFound": "Deadlock найден",
  "mods.chipMissing": "Игра не найдена",
  "mods.browseTitle": "GameBanana",
  "mods.searchPlaceholder": "Поиск модов…",
  "mods.searchBtn": "Найти",
  "mods.searchReset": "Сброс",
  "mods.pagePrev": "← Назад",
  "mods.pageNext": "Вперёд →",
  "mods.installedTitle": "Установленные моды",
  "mods.installedEmpty": "Пока ничего не установлено.",
  "mods.loading": "Загрузка каталога…",
  "mods.noResults": "Ничего не найдено.",
  "mods.install": "Установить",
  "mods.installFile": "Установить",
  "mods.installing": "Установка…",
  "mods.installDone": "Установлено.",
  "mods.filesLoading": "Получаем список файлов…",
  "mods.filesEmpty": "У мода нет активных файлов.",
  "mods.openGb": "GameBanana",
  "mods.enable": "Включить",
  "mods.disable": "Отключить",
  "mods.remove": "Удалить",
  "mods.statusDisabled": "выключен",
  "mods.statusMissing": "файлов нет на диске",
  "mods.installTitle": "Установка мода",
  "mods.removeTitle": "Удалить мод",
  "mods.removeBody": " будет удалён из папки addons. Восстановить файлы нельзя.",

  "modal.addTitle": "Новый профиль",
  "modal.addDesc": "Введите название профиля и добавьте его в список.",
  "modal.addLabel": "Название",
  "modal.addPlaceholder": "Например, Competitive",
  "modal.cancel": "Отмена",
  "modal.add": "Добавить",
  "modal.deleteTitle": "Удалить профиль",
  "modal.deleteDescA": "Профиль ",
  "modal.deleteDescB": " будет удалён. Это действие нельзя отменить.",
  "modal.delete": "Удалить",
};

const DICTS: Record<Lang, Dict> = { en: EN, ru: RU };

const STORAGE_KEY = "dl-lang";

let currentLang: Lang = "en";

export function getLang(): Lang {
  return currentLang;
}

export function t(key: string): string {
  return DICTS[currentLang]?.[key] ?? EN[key] ?? key;
}

export function setLang(lang: Lang): void {
  currentLang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  document.documentElement.setAttribute("lang", lang);
  applyAll();
  document.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang } }));
}

export function initI18n(): void {
  let lang: Lang = "en";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "ru") lang = saved;
  } catch {
    /* ignore */
  }
  currentLang = lang;
  document.documentElement.setAttribute("lang", lang);
  applyAll();
}

/**
 * Применяет переводы ко всем элементам с data-i18n / data-i18n-attr.
 * data-i18n="key" — заменяет textContent.
 * data-i18n-attr="title:tooltip;aria-label:close" — пары "attr:key" через ;
 */
export function applyAll(): void {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (!key) return;
    el.textContent = t(key);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-attr]").forEach((el) => {
    const spec = el.dataset.i18nAttr;
    if (!spec) return;
    for (const pair of spec.split(";")) {
      const idx = pair.indexOf(":");
      if (idx <= 0) continue;
      const attr = pair.slice(0, idx).trim();
      const key = pair.slice(idx + 1).trim();
      if (!attr || !key) continue;
      el.setAttribute(attr, t(key));
    }
  });
}

/**
 * Удобный подписчик на смену языка (например — для динамических строк, которые
 * не имеют data-i18n атрибута, как сообщения статуса обновлений).
 */
export function onLangChange(handler: (lang: Lang) => void): () => void {
  const cb = (e: Event) => {
    const detail = (e as CustomEvent<{ lang: Lang }>).detail;
    handler(detail?.lang || currentLang);
  };
  document.addEventListener("i18n:change", cb);
  return () => document.removeEventListener("i18n:change", cb);
}
