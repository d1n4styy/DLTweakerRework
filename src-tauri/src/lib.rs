mod app_restore;
mod game_config;
mod mod_manager;
mod quick_patch;

use serde_json::Value;
use std::process::Command;
use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn profiles_path() -> Result<std::path::PathBuf, String> {
    let base = dirs::data_dir().ok_or_else(|| "Не удалось определить каталог данных приложения".to_string())?;
    // Same file as Electron app (`package.json` name `deadlock-tweaker` → %AppData%\deadlock-tweaker\profiles.json).
    Ok(base.join("deadlock-tweaker").join("profiles.json"))
}

#[tauri::command]
fn profiles_load() -> Result<Option<Value>, String> {
    let path = profiles_path()?;
    match std::fs::read_to_string(&path) {
        Ok(s) => {
            let v: Value = serde_json::from_str(&s).map_err(|e| e.to_string())?;
            Ok(Some(v))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn profiles_save(data: Value) -> Result<(), String> {
    let path = profiles_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn tasklist_has(exe: &str) -> bool {
    // На Windows запуск консольных утилит из GUI может мигать отдельным окном.
    let out = match {
        let mut cmd = Command::new("tasklist");
        cmd.args(["/FI", &format!("IMAGENAME eq {}", exe), "/NH"]);
        #[cfg(target_os = "windows")]
        {
            // CREATE_NO_WINDOW
            cmd.creation_flags(0x08000000);
        }
        cmd
    }
    .output()
    {
        Ok(o) => o,
        Err(_) => return false,
    };
    let s = String::from_utf8_lossy(&out.stdout).to_lowercase();
    if s.trim().is_empty() || s.contains("info:") {
        return false;
    }
    s.contains(&exe.to_lowercase())
}

fn deadlock_process_status_value() -> Value {
    if !cfg!(target_os = "windows") {
        return serde_json::json!({"running": false, "image": null});
    }
    for image in ["deadlock.exe", "project8.exe"] {
        if tasklist_has(image) {
            return serde_json::json!({"running": true, "image": image});
        }
    }
    serde_json::json!({"running": false, "image": null})
}

#[tauri::command]
fn deadlock_process_status() -> Value {
    deadlock_process_status_value()
}

/// Один round-trip при старте главного окна: версия, статус игры, CSS quick-patch.
#[tauri::command]
async fn ui_startup_snapshot() -> Value {
    let version = env!("CARGO_PKG_VERSION").to_string();
    let game = deadlock_process_status_value();
    let quick_patch_css = quick_patch::quick_patch_get_css().await.unwrap_or_default();
    let autoexec = game_config::autoexec_status_value();
    serde_json::json!({
        "version": version,
        "game": game,
        "quickPatchCss": quick_patch_css,
        "autoexec": autoexec,
    })
}

/// Применить стилизацию системного titlebar Windows: тёмный caption / border + Mica/Acrylic.
#[cfg(target_os = "windows")]
fn apply_titlebar_styling<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    use tauri::Manager;
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR,
        DWMWA_SYSTEMBACKDROP_TYPE, DWMWA_TEXT_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE,
    };

    let hwnd_raw = match window.hwnd() {
        Ok(h) => h.0 as isize,
        Err(_) => return,
    };
    let hwnd = hwnd_raw as HWND;

    unsafe {
        // Иммерсивный тёмный режим: обеспечивает светлые иконки системных кнопок и тёмную рамку.
        let dark: u32 = 1;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE as u32,
            &dark as *const _ as *const _,
            std::mem::size_of_val(&dark) as u32,
        );

        // Отключаем системный backdrop (Mica/Acrylic), чтобы caption color применился буквально
        // и совпал с фоном приложения. Иначе Mica перекрашивает заголовок в свой оттенок.
        let backdrop_type: u32 = 1; // 0 Auto, 1 None, 2 Mica, 3 Acrylic, 4 Tabbed
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_SYSTEMBACKDROP_TYPE as u32,
            &backdrop_type as *const _ as *const _,
            std::mem::size_of_val(&backdrop_type) as u32,
        );

        // Цвет фона титулбара = фон приложения (#0a0a0a). COLORREF: 0x00BBGGRR.
        let caption_color: u32 = 0x000A0A0A;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_COLOR as u32,
            &caption_color as *const _ as *const _,
            std::mem::size_of_val(&caption_color) as u32,
        );

        // Цвет текста заголовка — приглушённый светлый, под общую палитру muted.
        // 0xFFFFFFFE — спец. значение «system default»; используем явный цвет.
        let text_color: u32 = 0x008A8A8A; // соответствует --muted #8a8a8a (BGR == RGB при равных каналах)
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_TEXT_COLOR as u32,
            &text_color as *const _ as *const _,
            std::mem::size_of_val(&text_color) as u32,
        );

        // Рамка окна — едва заметная, со слегка зелёным акцентом #0d130d (BGR 0x000D130D).
        let border_color: u32 = 0x000D130D;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR as u32,
            &border_color as *const _ as *const _,
            std::mem::size_of_val(&border_color) as u32,
        );
    }
}

/// Показать главное окно и закрыть сплэш (после проверки обновлений).
#[tauri::command]
async fn splash_open_main(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
        let _ = main.set_focus();
    }
    if let Some(splash) = app.get_webview_window("splash") {
        splash.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(splash) = app.handle().get_webview_window("splash") {
                let handle = app.handle().clone();
                let _ = splash.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        let main_vis = handle
                            .get_webview_window("main")
                            .and_then(|w| w.is_visible().ok())
                            .unwrap_or(false);
                        if !main_vis {
                            handle.exit(0);
                        }
                    }
                });
            }

            #[cfg(target_os = "windows")]
            if let Some(main) = app.handle().get_webview_window("main") {
                apply_titlebar_styling(&main);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            profiles_load,
            profiles_save,
            deadlock_process_status,
            ui_startup_snapshot,
            quick_patch::quick_patch_check_only,
            quick_patch::quick_patch_apply,
            quick_patch::quick_patch_get_css,
            game_config::autoexec_status,
            game_config::autoexec_create,
            mod_manager::mod_manager_browse,
            mod_manager::mod_manager_mod_files,
            mod_manager::mod_manager_install,
            mod_manager::mod_manager_list_installed,
            mod_manager::mod_manager_toggle,
            mod_manager::mod_manager_remove,
            app_restore::app_restore_list,
            app_restore::app_restore_create,
            app_restore::app_restore_apply,
            app_restore::app_restore_delete,
            splash_open_main,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
