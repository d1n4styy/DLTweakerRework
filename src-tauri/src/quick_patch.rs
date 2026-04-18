//! Quick-patch: манифест с GitHub, загрузка assets в `%AppData%\\deadlock-tweaker\\quick-patch\\active\\`
//! (как в Electron `quick-patch.js`).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const OWNER: &str = "d1n4styy";
const REPO: &str = "DLTweakerRework";
const QP_MANIFEST: &str = concat!(
    "https://raw.githubusercontent.com/",
    "d1n4styy/DLTweakerRework/main/quick-patch/manifest.json"
);
const MAX_ASSET_BYTES: usize = 3 * 1024 * 1024;

#[derive(Debug, Default, Serialize, Deserialize)]
struct QpState {
    #[serde(rename = "appliedId")]
    applied_id: Option<String>,
    #[serde(rename = "appliedAt")]
    applied_at: Option<String>,
}

fn qp_root() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or_else(|| "Не удалось определить каталог данных приложения".to_string())?;
    Ok(base.join("deadlock-tweaker").join("quick-patch"))
}

fn state_path(root: &Path) -> PathBuf {
    root.join("state.json")
}

fn active_dir(root: &Path) -> PathBuf {
    root.join("active")
}

fn semver_strip(v: &str) -> String {
    v.trim()
        .trim_start_matches(|c: char| c == 'v' || c == 'V')
        .trim()
        .to_string()
}

fn semver_parts(v: &str) -> (i32, i32, i32) {
    let s = semver_strip(v);
    let mut it = s.split('.');
    let a = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    let b = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    let c = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    (a, b, c)
}

fn semver_compare(a: &str, b: &str) -> std::cmp::Ordering {
    semver_parts(a).cmp(&semver_parts(b))
}

fn in_semver_range(cur: &str, min: &str, max: &str) -> bool {
    semver_compare(cur, min) != std::cmp::Ordering::Less
        && semver_compare(cur, max) != std::cmp::Ordering::Greater
}

fn safe_filename(name: &str) -> Option<String> {
    let s = name.trim();
    if s.is_empty() || s.contains("..") {
        return None;
    }
    if !s.chars().all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c)) {
        return None;
    }
    Some(s.to_string())
}

fn allowed_asset_url(u: &str) -> bool {
    let s = u.trim();
    let raw = format!("https://raw.githubusercontent.com/{OWNER}/{REPO}/");
    let gh_raw = format!("https://github.com/{OWNER}/{REPO}/raw/");
    s.starts_with(&raw) || s.starts_with(&gh_raw)
}

fn normalize_text_asset_bytes(buf: &[u8], filename: &str) -> Vec<u8> {
    let lower = filename.to_ascii_lowercase();
    if !lower.ends_with(".css")
        && !lower.ends_with(".json")
        && !lower.ends_with(".html")
        && !lower.ends_with(".htm")
        && !lower.ends_with(".md")
        && !lower.ends_with(".txt")
        && !lower.ends_with(".yml")
        && !lower.ends_with(".yaml")
    {
        return buf.to_vec();
    }
    let Ok(t) = std::str::from_utf8(buf) else {
        return buf.to_vec();
    };
    let normalized = t.replace("\r\n", "\n").replace('\r', "\n");
    normalized.into_bytes()
}

fn sha256_hex(buf: &[u8]) -> String {
    let mut h = Sha256::new();
    Digest::update(&mut h, buf);
    h.finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

async fn load_state(root: &Path) -> QpState {
    let p = state_path(root);
    match tokio::fs::read_to_string(&p).await {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => QpState::default(),
    }
}

async fn save_state(root: &Path, state: &QpState) -> Result<(), String> {
    tokio::fs::create_dir_all(root)
        .await
        .map_err(|e| e.to_string())?;
    let p = state_path(root);
    let s = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    tokio::fs::write(&p, s).await.map_err(|e| e.to_string())
}

async fn fetch_manifest(client: &reqwest::Client) -> Result<Value, String> {
    let res = client
        .get(QP_MANIFEST)
        .header("Accept", "application/json")
        .header("User-Agent", "DeadlockTweaker-Rework/quick-patch")
        .header("Cache-Control", "no-cache")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "таймаут (12 с)".to_string()
            } else {
                e.to_string()
            }
        })?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    let text = res.text().await.map_err(|e| e.to_string())?;
    let t = text.trim_start();
    if t.starts_with('<') {
        return Err("Вместо манифеста пришла HTML-страница (сеть, прокси или блокировка).".into());
    }
    serde_json::from_str(&text).map_err(|_| "Ответ не является корректным JSON.".to_string())
}

async fn fetch_asset(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let res = client
        .get(url)
        .header("User-Agent", "DeadlockTweaker-Rework/quick-patch")
        .header("Cache-Control", "no-cache")
        .timeout(std::time::Duration::from_secs(35))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    if let Some(len) = res.content_length() {
        if len as usize > MAX_ASSET_BYTES {
            return Err("Слишком большой файл".into());
        }
    }
    let buf = res.bytes().await.map_err(|e| e.to_string())?;
    if buf.len() > MAX_ASSET_BYTES {
        return Err("Слишком большой файл".into());
    }
    Ok(buf.to_vec())
}

fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

async fn resolve_status(client: &reqwest::Client, silent: bool) -> Value {
    let root = match qp_root() {
        Ok(p) => p,
        Err(e) => {
            return json!({
                "ok": false,
                "code": "path",
                "message": if silent { String::new() } else { e }
            });
        }
    };

    let manifest = match fetch_manifest(client).await {
        Ok(m) => m,
        Err(msg) => {
            return json!({
                "ok": false,
                "code": "fetch",
                "message": if silent {
                    String::new()
                } else {
                    format!("Манифест: {msg}")
                }
            });
        }
    };

    if !manifest.is_object() {
        return json!({
            "ok": false,
            "code": "bad",
            "message": if silent {
                String::new()
            } else {
                "Некорректный манифест".to_string()
            }
        });
    }

    let id = manifest
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if id.is_empty() {
        return json!({
            "ok": false,
            "code": "bad",
            "message": if silent {
                String::new()
            } else {
                "В манифесте нет id".to_string()
            }
        });
    }

    let min_v = semver_strip(
        manifest
            .get("minAppSemver")
            .and_then(|v| v.as_str())
            .unwrap_or("0.0.0"),
    );
    let max_v = semver_strip(
        manifest
            .get("maxAppSemver")
            .and_then(|v| v.as_str())
            .unwrap_or("999.999.999"),
    );
    let cur_ver = app_version();

    if !in_semver_range(&cur_ver, &min_v, &max_v) {
        return json!({
            "ok": true,
            "code": "range",
            "id": id,
            "minV": min_v,
            "maxV": max_v,
            "message": if silent {
                String::new()
            } else {
                format!("Этот патч не для версии {cur_ver} (диапазон {min_v}…{max_v}).")
            }
        });
    }

    let state = load_state(&root).await;
    if state.applied_id.as_deref() == Some(id.as_str()) {
        return json!({
            "ok": true,
            "code": "uptodate",
            "id": id,
            "message": if silent {
                String::new()
            } else {
                "Уже применён.".to_string()
            }
        });
    }

    let assets = manifest
        .get("assets")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();
    if assets.is_empty() {
        return json!({
            "ok": true,
            "code": "noop",
            "id": id,
            "message": if silent {
                String::new()
            } else {
                "В манифесте пока нет файлов — для правок только текста/CSS добавьте assets.".to_string()
            }
        });
    }

    let description = manifest
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let msg = if silent {
        String::new()
    } else if !description.is_empty() {
        format!("Доступен патч «{id}» — {description}")
    } else {
        format!("Доступен патч «{id}».")
    };

    json!({
        "ok": true,
        "code": "available",
        "id": id,
        "description": description,
        "message": msg
    })
}

#[tauri::command]
pub async fn quick_patch_check_only() -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;
    Ok(resolve_status(&client, false).await)
}

#[tauri::command]
pub async fn quick_patch_apply(silent: Option<bool>) -> Result<Value, String> {
    let silent = silent.unwrap_or(false);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;

    let st = resolve_status(&client, silent).await;
    let ok = st.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    if !ok {
        return Ok(json!({
            "ok": false,
            "code": st.get("code").and_then(|v| v.as_str()).unwrap_or("bad"),
            "message": st.get("message").and_then(|v| v.as_str()).unwrap_or("")
        }));
    }

    let code = st
        .get("code")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if code == "range" || code == "uptodate" || code == "noop" {
        return Ok(json!({
            "ok": true,
            "code": code,
            "message": st.get("message").and_then(|v| v.as_str()).unwrap_or(""),
            "id": st.get("id").and_then(|v| v.as_str()).unwrap_or("")
        }));
    }
    if code != "available" {
        return Ok(json!({
            "ok": false,
            "code": "bad",
            "message": if silent {
                String::new()
            } else {
                "Неизвестное состояние патча".to_string()
            }
        }));
    }

    let id = st
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let root = qp_root()?;
    let dir = active_dir(&root);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;

    let manifest = fetch_manifest(&client).await.map_err(|e| e.to_string())?;
    let assets = manifest
        .get("assets")
        .and_then(|a| a.as_array())
        .cloned()
        .unwrap_or_default();

    let mut state = load_state(&root).await;

    for a in &assets {
        let url = a.get("url").and_then(|v| v.as_str()).unwrap_or("").trim();
        let rel = a
            .get("path")
            .and_then(|v| v.as_str())
            .or_else(|| a.get("name").and_then(|v| v.as_str()))
            .unwrap_or("")
            .trim();
        let Some(rel_safe) = safe_filename(rel) else {
            return Ok(json!({
                "ok": false,
                "code": "bad",
                "message": if silent {
                    String::new()
                } else {
                    "Недопустимый URL или имя файла".to_string()
                }
            }));
        };
        if url.is_empty() || !allowed_asset_url(url) {
            return Ok(json!({
                "ok": false,
                "code": "bad",
                "message": if silent {
                    String::new()
                } else {
                    "Недопустимый URL или имя файла".to_string()
                }
            }));
        }

        let mut buf = fetch_asset(&client, url).await.map_err(|e| e.to_string())?;
        buf = normalize_text_asset_bytes(&buf, &rel_safe);
        if let Some(want) = a.get("sha256").and_then(|v| v.as_str()) {
            let want = want.to_lowercase();
            let got = sha256_hex(&buf);
            if want != got {
                return Ok(json!({
                    "ok": false,
                    "code": "hash",
                    "message": if silent {
                        String::new()
                    } else {
                        "Не сошлась контрольная сумма загруженного файла.".to_string()
                    }
                }));
            }
        }

        let dest = dir.join(&rel_safe);
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }
        tokio::fs::write(&dest, buf)
            .await
            .map_err(|e| e.to_string())?;
    }

    state.applied_id = Some(id.clone());
    state.applied_at = Some(qp_applied_timestamp());
    save_state(&root, &state).await?;

    Ok(json!({
        "ok": true,
        "code": "applied",
        "message": if silent {
            String::new()
        } else {
            format!("Патч «{id}» загружен.")
        },
        "id": id
    }))
}

fn qp_applied_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn quick_patch_get_css() -> Result<String, String> {
    let root = qp_root()?;
    let dir = active_dir(&root);
    let mut rd = match tokio::fs::read_dir(&dir).await {
        Ok(r) => r,
        Err(_) => return Ok(String::new()),
    };
    let mut names: Vec<String> = Vec::new();
    while let Ok(Some(e)) = rd.next_entry().await {
        let Ok(ft) = e.file_type().await else {
            continue;
        };
        if !ft.is_file() {
            continue;
        }
        let n = e.file_name().to_string_lossy().into_owned();
        if n.ends_with(".css") {
            names.push(n);
        }
    }
    names.sort();
    if names.is_empty() {
        return Ok(String::new());
    }
    let mut parts: Vec<String> = Vec::new();
    for f in names {
        let p = dir.join(&f);
        if let Ok(s) = tokio::fs::read_to_string(&p).await {
            parts.push(s);
        }
    }
    Ok(parts.join("\n\n"))
}