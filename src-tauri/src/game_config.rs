//! Поиск установки Deadlock через Steam и работа с `autoexec.cfg`.
//!
//! Порядок поиска папки игры:
//! 1) Реестр Windows → путь установки Steam (`HKCU\Software\Valve\Steam\SteamPath`,
//!    запасной — `HKLM\SOFTWARE\WOW6432Node\Valve\Steam\InstallPath`).
//! 2) `<steam>/steamapps/libraryfolders.vdf` — парсим библиотеки и их `apps`.
//! 3) Ищем библиотеку, в которой присутствует AppID `1422450` (Deadlock), и
//!    проверяем `<lib>/steamapps/common/Deadlock`.
//! 4) Если не нашли — возвращаем `None` (а не «угадываем» путь).
//!
//! Целевой файл: `<Deadlock>/game/citadel/cfg/autoexec.cfg`.

use serde::Serialize;
use std::path::{Path, PathBuf};

const DEADLOCK_APP_ID: &str = "1422450";
const DEFAULT_AUTOEXEC_BODY: &str = concat!(
    "// autoexec.cfg — создан Deadlock Tweaker.\n",
    "// Этот файл читается Source 2 при запуске игры.\n",
    "// Добавляйте сюда пользовательские cvar'ы и биндинги.\n",
    "\n",
    "echo \"[Deadlock Tweaker] autoexec.cfg loaded\"\n",
);

#[derive(Debug, Serialize, Clone)]
pub struct AutoexecStatus {
    /// Удалось ли найти установку игры (папка Deadlock существует).
    pub game_found: bool,
    /// Существует ли сам `autoexec.cfg`.
    pub config_found: bool,
    /// Полный путь к каталогу игры Deadlock (если найден).
    pub game_dir: Option<String>,
    /// Полный путь к `game/citadel/cfg/autoexec.cfg` (если вычислен).
    pub cfg_path: Option<String>,
    /// Текст ошибки/диагностики для UI (не фатальной).
    pub error: Option<String>,
}

/// Путь установки Steam из реестра Windows.
#[cfg(target_os = "windows")]
fn steam_path_from_registry() -> Option<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    if let Ok(k) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam") {
        if let Ok(s) = k.get_value::<String, _>("SteamPath") {
            let p = PathBuf::from(s.replace('/', "\\"));
            if p.is_dir() {
                return Some(p);
            }
        }
    }

    for (hive, sub) in [
        (HKEY_LOCAL_MACHINE, "SOFTWARE\\WOW6432Node\\Valve\\Steam"),
        (HKEY_LOCAL_MACHINE, "SOFTWARE\\Valve\\Steam"),
    ] {
        if let Ok(k) = RegKey::predef(hive).open_subkey(sub) {
            if let Ok(s) = k.get_value::<String, _>("InstallPath") {
                let p = PathBuf::from(s);
                if p.is_dir() {
                    return Some(p);
                }
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn steam_path_from_registry() -> Option<PathBuf> {
    None
}

/// Примитивный парсер VDF: находит все `"path" "<...>"` и блоки `"apps" { ... }`
/// с их AppID'шниками. VDF-формат достаточно стабилен, чтобы обойтись без крейта.
fn parse_library_folders_vdf(vdf: &str) -> Vec<(PathBuf, Vec<String>)> {
    // Каждая библиотека описана как блок с ключом-индексом ("0", "1", ...).
    // Внутри блока: "path" "C:\\..." и подблок "apps" { "<appid>" "<size>" ... }.
    // Здесь достаточно последовательного прохода.
    let mut out: Vec<(PathBuf, Vec<String>)> = Vec::new();
    let mut current_path: Option<PathBuf> = None;
    let mut current_apps: Vec<String> = Vec::new();
    let mut in_apps = false;
    let mut depth: i32 = 0;

    for raw_line in vdf.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        if line == "{" {
            depth += 1;
            continue;
        }
        if line == "}" {
            depth -= 1;
            if in_apps {
                in_apps = false;
                continue;
            }
            // Закрытие блока библиотеки.
            if depth <= 1 {
                if let Some(p) = current_path.take() {
                    out.push((p, std::mem::take(&mut current_apps)));
                }
            }
            continue;
        }

        // Пара "key" "value" или "key" (+ следующий блок {).
        let parts = collect_vdf_tokens(line);
        if parts.is_empty() {
            continue;
        }
        let key = parts[0].to_ascii_lowercase();

        if in_apps {
            // Внутри "apps": каждая строка "<appid>" "<size>"
            if parts.len() >= 1 {
                out_push_app(&mut current_apps, &parts[0]);
            }
            continue;
        }

        match key.as_str() {
            "path" if parts.len() >= 2 => {
                // Нормализуем двойные бэкслеши: в VDF они экранированы.
                let normalized = parts[1].replace("\\\\", "\\");
                current_path = Some(PathBuf::from(normalized));
            }
            "apps" => {
                in_apps = true;
            }
            _ => {}
        }
    }

    // Хвостовой блок без закрытия — не должен встретиться, но на всякий случай.
    if let Some(p) = current_path.take() {
        out.push((p, current_apps));
    }
    out
}

fn out_push_app(apps: &mut Vec<String>, raw: &str) {
    let cleaned: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    if !cleaned.is_empty() {
        apps.push(cleaned);
    }
}

/// Разбирает строку VDF на токены в кавычках: `"k" "v"` → ["k", "v"].
fn collect_vdf_tokens(line: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut buf = String::new();
    let mut in_str = false;
    let mut escape = false;

    for ch in line.chars() {
        if escape {
            buf.push(ch);
            escape = false;
            continue;
        }
        if ch == '\\' && in_str {
            escape = true;
            continue;
        }
        if ch == '"' {
            if in_str {
                out.push(std::mem::take(&mut buf));
            }
            in_str = !in_str;
            continue;
        }
        if in_str {
            buf.push(ch);
        }
    }
    out
}

/// Найти каталог установки Deadlock через Steam. `None` — если не удалось.
pub fn find_deadlock_install_dir() -> Option<PathBuf> {
    let steam = steam_path_from_registry()?;
    let vdf_path = steam.join("steamapps").join("libraryfolders.vdf");
    let vdf = std::fs::read_to_string(&vdf_path).ok()?;
    let libs = parse_library_folders_vdf(&vdf);

    // Сначала ищем библиотеку, в манифесте которой указан наш AppID.
    for (lib, apps) in &libs {
        if apps.iter().any(|a| a == DEADLOCK_APP_ID) {
            let candidate = lib.join("steamapps").join("common").join("Deadlock");
            if candidate.is_dir() {
                return Some(candidate);
            }
        }
    }
    // Запасной вариант: проверяем все библиотеки на наличие папки Deadlock.
    for (lib, _apps) in &libs {
        let candidate = lib.join("steamapps").join("common").join("Deadlock");
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    // Последняя попытка — сам каталог Steam как библиотека.
    let candidate = steam.join("steamapps").join("common").join("Deadlock");
    if candidate.is_dir() {
        return Some(candidate);
    }
    None
}

pub fn autoexec_path_for(game_dir: &Path) -> PathBuf {
    game_dir
        .join("game")
        .join("citadel")
        .join("cfg")
        .join("autoexec.cfg")
}

/// Команда Tauri: статус `autoexec.cfg`.
pub fn autoexec_status_value() -> AutoexecStatus {
    let Some(game_dir) = find_deadlock_install_dir() else {
        return AutoexecStatus {
            game_found: false,
            config_found: false,
            game_dir: None,
            cfg_path: None,
            error: Some("Deadlock install not found via Steam.".to_string()),
        };
    };

    let cfg = autoexec_path_for(&game_dir);
    let config_found = cfg.is_file();
    AutoexecStatus {
        game_found: true,
        config_found,
        game_dir: Some(game_dir.to_string_lossy().to_string()),
        cfg_path: Some(cfg.to_string_lossy().to_string()),
        error: None,
    }
}

#[tauri::command]
pub fn autoexec_status() -> AutoexecStatus {
    autoexec_status_value()
}

#[tauri::command]
pub fn autoexec_create() -> Result<AutoexecStatus, String> {
    let game_dir = find_deadlock_install_dir()
        .ok_or_else(|| "Deadlock install not found via Steam.".to_string())?;

    let cfg = autoexec_path_for(&game_dir);
    if let Some(parent) = cfg.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Create cfg dir failed: {e}"))?;
    }
    if !cfg.is_file() {
        std::fs::write(&cfg, DEFAULT_AUTOEXEC_BODY)
            .map_err(|e| format!("Write autoexec.cfg failed: {e}"))?;
    }

    Ok(AutoexecStatus {
        game_found: true,
        config_found: cfg.is_file(),
        game_dir: Some(game_dir.to_string_lossy().to_string()),
        cfg_path: Some(cfg.to_string_lossy().to_string()),
        error: None,
    })
}
