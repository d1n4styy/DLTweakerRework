import "./splash.css";
import { invoke } from "@tauri-apps/api/core";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type SplashPhase =
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "uptodate"
  | "launching"
  | "offline"
  | "dev"
  | "updatedone";

type SplashPayload = {
  phase: SplashPhase;
  message?: string;
  detail?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  downloadedTotal?: number;
  installIndeterminate?: boolean;
};

function formatBytes(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  let v = Number(n);
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  if (i === 0) return `${Math.round(v)} ${units[i]}`;
  const dec = v < 10 && i > 0 ? 1 : 0;
  return `${v.toFixed(dec)} ${units[i]}`;
}

const line = document.getElementById("splash-line");
const sub = document.getElementById("splash-sub");
const progressWrap = document.getElementById("splash-progress-wrap");
const progressBar = progressWrap?.querySelector(".progress") ?? null;
const progressFill = document.getElementById("splash-progress-fill");

function setIndeterminate(on: boolean): void {
  if (progressBar) progressBar.classList.toggle("indeterminate", Boolean(on));
}

function setProgress(
  pct: number | null | undefined,
  opts?: { indeterminate?: boolean; keepVisible?: boolean },
): void {
  const options = opts || {};
  if (!progressWrap || !progressFill) return;
  if (pct == null || Number.isNaN(pct)) {
    if (!options.keepVisible) {
      progressWrap.hidden = true;
      progressFill.style.width = "0%";
      setIndeterminate(false);
    }
    return;
  }
  progressWrap.hidden = false;
  setIndeterminate(Boolean(options.indeterminate));
  if (options.indeterminate) {
    progressFill.style.width = "";
  } else {
    const v = Math.max(0, Math.min(100, pct));
    progressFill.style.width = `${v}%`;
  }
}

function applyPayload(payload: SplashPayload): void {
  if (!payload) return;
  if (line && payload.message) line.textContent = payload.message;
  if (sub) {
    const hints: Record<string, string> = {
      checking: "Подключение к серверу обновлений",
      available: "Скоро начнётся загрузка",
      downloading: "Не закрывайте это окно",
      installing: "Установка обновления…",
      uptodate: "Переход к основному окну",
      launching: "Почти готово",
      offline: "Обновления недоступны, открываем приложение",
      dev: "Сборка разработчика",
      updatedone: "Открываем основное приложение",
    };
    let extra = "";
    if (payload.phase === "downloading") {
      const t = payload.transferred;
      const tot = payload.total;
      const bps = payload.bytesPerSecond;
      if (t != null && tot != null) {
        extra = `${formatBytes(t)} из ${formatBytes(tot)}`;
        if (bps != null && !Number.isNaN(Number(bps)) && Number(bps) > 0) {
          extra += ` · ${formatBytes(bps)}/с`;
        }
      }
    } else if (
      payload.phase === "installing" &&
      payload.downloadedTotal != null &&
      Number(payload.downloadedTotal) > 0
    ) {
      extra = `Загружено ${formatBytes(payload.downloadedTotal)}`;
    }
    let subText = extra || hints[payload.phase] || "";
    if (payload.detail && String(payload.detail).trim()) {
      const d = String(payload.detail).trim();
      subText = subText ? `${subText}\n\n${d}` : d;
    }
    sub.textContent = subText;
  }
  if (payload.phase === "downloading" && typeof payload.percent === "number") {
    setProgress(payload.percent, { indeterminate: false });
  } else if (payload.phase === "installing" && payload.installIndeterminate) {
    setProgress(0, { indeterminate: true });
  } else if (payload.phase === "updatedone" && typeof payload.percent === "number") {
    setProgress(payload.percent, { indeterminate: false });
  } else if (payload.phase === "launching" && typeof payload.percent === "number") {
    setProgress(payload.percent, { indeterminate: false });
  } else if (
    payload.phase !== "downloading" &&
    payload.phase !== "installing" &&
    payload.phase !== "updatedone"
  ) {
    setProgress(null);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function openMainApp(): Promise<void> {
  applyPayload({ phase: "launching", message: "Запуск приложения…" });
  await sleep(220);
  await invoke("splash_open_main");
}

async function runSplashUpdateFlow(): Promise<void> {
  applyPayload({ phase: "checking", message: "Проверка обновлений…" });
  await sleep(90);

  try {
    const update = await check({ timeout: 14_000 });
    if (update) {
      applyPayload({
        phase: "available",
        message: `Доступна версия ${update.version}`,
      });
      await sleep(420);

      let downloaded = 0;
      let total = 0;
      let lastTick = performance.now();
      let lastBytes = 0;

      applyPayload({
        phase: "downloading",
        message: "Загрузка обновления…",
        percent: 0,
        transferred: 0,
        total: 0,
        bytesPerSecond: 0,
      });

      const onEvent = (e: DownloadEvent) => {
        if (e.event === "Started") {
          total = e.data.contentLength ?? 0;
          downloaded = 0;
          lastTick = performance.now();
          lastBytes = 0;
          applyPayload({
            phase: "downloading",
            message: "Загрузка обновления…",
            percent: 0,
            transferred: 0,
            total,
            bytesPerSecond: 0,
          });
        } else if (e.event === "Progress") {
          downloaded += e.data.chunkLength;
          const now = performance.now();
          const dt = (now - lastTick) / 1000;
          let bps = 0;
          if (dt > 0.2) {
            bps = (downloaded - lastBytes) / dt;
            lastTick = now;
            lastBytes = downloaded;
          }
          const pct = total > 0 ? Math.round((downloaded / total) * 100) : undefined;
          applyPayload({
            phase: "downloading",
            message: "Загрузка обновления…",
            percent: pct ?? 0,
            transferred: downloaded,
            total,
            bytesPerSecond: bps,
          });
        }
      };

      try {
        await update.downloadAndInstall(onEvent);
      } catch (err) {
        applyPayload({
          phase: "offline",
          message: "Не удалось установить обновление",
          detail: err instanceof Error ? err.message : String(err),
        });
        await sleep(650);
        await openMainApp();
        return;
      }

      applyPayload({
        phase: "installing",
        message: "Применение обновления…",
        installIndeterminate: true,
        percent: 100,
        downloadedTotal: downloaded || undefined,
      });
      await sleep(200);
      await relaunch();
      return;
    }

    applyPayload({ phase: "uptodate", message: "Установлена последняя версия" });
    await sleep(280);
    await openMainApp();
  } catch (err) {
    applyPayload({
      phase: "offline",
      message: "Обновления недоступны, открываем приложение",
      detail: err instanceof Error ? err.message : String(err),
    });
    await sleep(520);
    await openMainApp();
  }
}

void runSplashUpdateFlow();
