#!/usr/bin/env node
// Обновляет `quick-patch/manifest.json`:
//  1) пересчитывает `sha256` каждого ассета по фактическому содержимому файла
//     в `quick-patch/` (с теми же правилами нормализации, что и в Rust —
//     CRLF/CR → LF для текстовых расширений).
//  2) по желанию бампает `id` (флаг --bump): отрезает хвостовой `-<число>`
//     и увеличивает на 1; если хвоста нет — добавляет `-2`.
//
// Использование:
//   node scripts/qp-sync.mjs           # только пересинхронизировать sha256
//   node scripts/qp-sync.mjs --bump    # ещё и увеличить id патча
//
// Важно: правила нормализации ДОЛЖНЫ совпадать с
// `src-tauri/src/quick_patch.rs::normalize_text_asset_bytes`.

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const QP_DIR = join(ROOT, "quick-patch");
const MANIFEST = join(QP_DIR, "manifest.json");

const TEXT_EXT = new Set([
  ".css",
  ".json",
  ".html",
  ".htm",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
]);

function isTextPath(p) {
  const i = p.lastIndexOf(".");
  if (i < 0) return false;
  return TEXT_EXT.has(p.slice(i).toLowerCase());
}

function normalizeIfText(buf, path) {
  if (!isTextPath(path)) return buf;
  return Buffer.from(
    buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
    "utf8"
  );
}

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function bumpId(id) {
  const m = id.match(/^(.*)-(\d+)$/);
  if (m) return `${m[1]}-${Number(m[2]) + 1}`;
  return `${id}-2`;
}

async function main() {
  const bump = process.argv.includes("--bump");
  const raw = await readFile(MANIFEST, "utf8");
  const manifest = JSON.parse(raw);

  if (!Array.isArray(manifest.assets)) {
    throw new Error("manifest.assets должен быть массивом");
  }

  let changed = false;
  for (const asset of manifest.assets) {
    const rel = (asset.path || asset.name || "").trim();
    if (!rel) throw new Error("asset без path/name");
    const filePath = join(QP_DIR, rel);
    const buf = await readFile(filePath);
    const norm = normalizeIfText(buf, rel);
    const hash = sha256Hex(norm);
    if (asset.sha256 !== hash) {
      console.log(`[qp-sync] ${rel}: ${asset.sha256 ?? "(none)"} -> ${hash}`);
      asset.sha256 = hash;
      changed = true;
    } else {
      console.log(`[qp-sync] ${rel}: sha256 already in sync (${hash.slice(0, 12)}…)`);
    }
  }

  if (bump) {
    const prev = manifest.id;
    manifest.id = bumpId(String(manifest.id || "qp-rework-0.0.0-1"));
    if (prev !== manifest.id) {
      console.log(`[qp-sync] id: ${prev} -> ${manifest.id}`);
      changed = true;
    }
  }

  if (!changed) {
    console.log("[qp-sync] манифест уже актуален, ничего не записываю");
    return;
  }

  const out = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(MANIFEST, out, "utf8");
  console.log(`[qp-sync] записан ${MANIFEST}`);
}

main().catch((e) => {
  console.error(`[qp-sync] ошибка: ${e.message}`);
  process.exit(1);
});
