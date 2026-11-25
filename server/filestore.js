/**
 * Node persistence for the store: one JSON file, written so it can't eat itself.
 *
 *   - Writes go to a temp file, are fsynced, then renamed over the real one.
 *     A rename is atomic, so a crash leaves either the old file or the new
 *     one on disk, never half of each.
 *   - Rolling backups (hourly, last 48 kept) sit next to it.
 *   - If the file can't be read, it is set aside (never overwritten) and the
 *     newest readable backup is restored in its place. If no backup reads
 *     either, the server refuses to start rather than lose every account.
 *
 * The file lives in DATA_DIR (default: this folder). On Render, point DATA_DIR
 * at a persistent disk or every deploy starts from nothing. (On Cloudflare the
 * store lives in the Durable Object instead — see cloudflare/game.js.)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachStore, dbFrom, emptyDb, snapshot, pruneSessions } from "./store.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(process.env.DATA_DIR || HERE);
const FILE = path.join(DATA_DIR, "data.json");
const TMP = FILE + ".tmp";
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const BACKUP_EVERY_MS = 60 * 60 * 1000;
const BACKUPS_KEPT = 48;

export const dataFile = () => FILE;

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // A leftover temp file means a write was interrupted. The real file is
  // still the last good copy, so the temp one is just discarded.
  if (fs.existsSync(TMP)) fs.rmSync(TMP);
  if (!fs.existsSync(FILE)) return emptyDb();

  const raw = fs.readFileSync(FILE, "utf8");
  // A zero-byte file is a fresh install (the repo used to ship one), not damage.
  if (!raw.trim()) return emptyDb();
  try {
    return dbFrom(JSON.parse(raw));
  } catch (e) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const aside = path.join(DATA_DIR, `data.corrupt-${stamp}.json`);
    fs.renameSync(FILE, aside);
    console.error(`[store] ${FILE} is unreadable (${e.message}). Moved it to ${aside}.`);

    const backups = fs.existsSync(BACKUP_DIR)
      ? fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith("data-")).sort().reverse()
      : [];
    for (const f of backups) {
      try {
        const full = path.join(BACKUP_DIR, f);
        const db = dbFrom(JSON.parse(fs.readFileSync(full, "utf8")));
        fs.copyFileSync(full, FILE);
        console.error(`[store] Restored ${f} — anything saved after that backup is lost.`);
        return db;
      } catch {
        console.error(`[store] Backup ${f} is unreadable too, trying an older one.`);
      }
    }
    console.error(`[store] No readable backup in ${BACKUP_DIR}. Refusing to start rather than lose accounts.`);
    process.exit(1);
  }
}

let dirty = false;
let writing = false;

function writeAtomic(json) {
  const fd = fs.openSync(TMP, "w");
  try {
    fs.writeSync(fd, json);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(TMP, FILE);
}

function save() {
  if (!dirty || writing) return;
  writing = true;
  dirty = false;
  try {
    writeAtomic(JSON.stringify(snapshot()));
  } catch (e) {
    dirty = true; // try again next tick
    console.error("[store] write failed:", e.message);
  } finally {
    writing = false;
  }
}

function backup() {
  if (!fs.existsSync(FILE)) return;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(FILE, path.join(BACKUP_DIR, `data-${stamp}.json`));
    const old = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith("data-")).sort();
    for (const f of old.slice(0, Math.max(0, old.length - BACKUPS_KEPT))) fs.rmSync(path.join(BACKUP_DIR, f));
  } catch (e) {
    console.error("[store] backup failed:", e.message);
  }
}

/** Loads the file and starts saving: every change marks the file dirty; it's written every 2 s. */
export function openFileStore() {
  attachStore(load(), () => { dirty = true; }, () => { dirty = true; writing = false; save(); });
  setInterval(save, 2000).unref();
  setInterval(pruneSessions, 60 * 60 * 1000).unref();
  backup();
  setInterval(backup, BACKUP_EVERY_MS).unref();
}
