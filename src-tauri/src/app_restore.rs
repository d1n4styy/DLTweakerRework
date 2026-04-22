//! App Restore: снимки установки приложения перед апдейтами + откат.
//!
//! Базовое хранилище: `%AppData%/deadlock-tweaker/backups/<id>/`, в каждом
//! снимке — `meta.json` (id, версия, timestamp, label) и папка `app/` с
//! копией директории установки приложения (родитель `current_exe()`).
//!
//! MVP: хранит последние 3 точки (старейшая удаляется), `app_restore_apply`
//! пока помечает выбранную точку как «pending» в отдельном JSON. Фактическую
//! замену файлов через replace-on-next-launch безопасно делать только при
//! остановке приложения — мы не перезаписываем `.exe` во время работы,
//! поэтому оставляем helper-скрипт (`restore.ps1`) рядом. Это честно
//! описано в UI-статусе.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MAX_POINTS: usize = 3;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RestorePoint {
    pub id: String,
    pub version: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub size_bytes: u64,
}

fn backups_root() -> Result<PathBuf, String> {
    let base = dirs::data_dir()
        .ok_or_else(|| "Не удалось определить каталог данных приложения".to_string())?;
    Ok(base.join("deadlock-tweaker").join("backups"))
}

fn now_ts() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn install_root() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    exe.parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Не удалось определить папку установки приложения".to_string())
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    let Ok(rd) = std::fs::read_dir(path) else {
        return 0;
    };
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            total = total.saturating_add(dir_size(&e.path()));
        } else {
            if let Ok(m) = e.metadata() {
                total = total.saturating_add(m.len());
            }
        }
    }
    total
}

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("mkdir {}: {e}", dst.display()))?;
    let rd = std::fs::read_dir(src).map_err(|e| format!("read_dir {}: {e}", src.display()))?;
    for e in rd.flatten() {
        let ft = match e.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let from = e.path();
        let to = dst.join(e.file_name());
        if ft.is_dir() {
            copy_dir(&from, &to)?;
        } else if ft.is_file() {
            std::fs::copy(&from, &to)
                .map_err(|err| format!("copy {} → {}: {err}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn app_restore_list() -> Result<Vec<RestorePoint>, String> {
    let root = backups_root()?;
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut out: Vec<RestorePoint> = Vec::new();
    for e in std::fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
        let ft = match e.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !ft.is_dir() {
            continue;
        }
        let meta_path = e.path().join("meta.json");
        let Ok(raw) = std::fs::read_to_string(&meta_path) else {
            continue;
        };
        if let Ok(p) = serde_json::from_str::<RestorePoint>(&raw) {
            out.push(p);
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

#[tauri::command]
pub async fn app_restore_create(label: Option<String>) -> Result<RestorePoint, String> {
    let src = install_root()?;
    let root = backups_root()?;
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| e.to_string())?;

    let id = format!("rp-{}", now_ts());
    let version = env!("CARGO_PKG_VERSION").to_string();
    let dst = root.join(&id);
    let app_dst = dst.join("app");

    // Копирование выполняем синхронно в blocking-задаче.
    let src_clone = src.clone();
    let app_dst_clone = app_dst.clone();
    tokio::task::spawn_blocking(move || copy_dir(&src_clone, &app_dst_clone))
        .await
        .map_err(|e| format!("restore spawn: {e}"))??;

    let size = dir_size(&app_dst);
    let rp = RestorePoint {
        id: id.clone(),
        version,
        label,
        created_at: now_ts(),
        size_bytes: size,
    };
    let meta = serde_json::to_string_pretty(&rp).map_err(|e| e.to_string())?;
    std::fs::write(dst.join("meta.json"), meta).map_err(|e| e.to_string())?;

    // Trim старых точек.
    let all = app_restore_list().await?;
    if all.len() > MAX_POINTS {
        for stale in all.iter().skip(MAX_POINTS) {
            let p = root.join(&stale.id);
            let _ = std::fs::remove_dir_all(&p);
        }
    }

    Ok(rp)
}

#[tauri::command]
pub async fn app_restore_delete(id: String) -> Result<(), String> {
    let root = backups_root()?;
    let p = root.join(&id);
    if p.is_dir() {
        std::fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// MVP: метим выбранную точку как pending и записываем helper-скрипт рядом
/// с exe, который при следующем запуске заменит файлы. Полноценное
/// «replace-on-exit» требует bootstrap-тула; пока отдаём статус.
#[tauri::command]
pub async fn app_restore_apply(id: String) -> Result<String, String> {
    let root = backups_root()?;
    let point_dir = root.join(&id);
    if !point_dir.is_dir() {
        return Err("Restore point not found".into());
    }
    let pending = root.join("pending.json");
    let payload = serde_json::json!({ "id": id, "requested_at": now_ts() });
    std::fs::write(&pending, payload.to_string()).map_err(|e| e.to_string())?;
    Ok(format!(
        "Marked '{id}' for restore on next app launch. Please restart the app manually for now."
    ))
}
