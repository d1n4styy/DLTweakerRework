mod quick_patch;

use serde_json::Value;
use std::process::Command;
use tauri::Manager;
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
    let out = match Command::new("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {}", exe), "/NH"])
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

#[tauri::command]
fn deadlock_process_status() -> Value {
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            profiles_load,
            profiles_save,
            deadlock_process_status,
            quick_patch::quick_patch_check_only,
            quick_patch::quick_patch_apply,
            quick_patch::quick_patch_get_css,
            splash_open_main,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
