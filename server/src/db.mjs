import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export function openDatabase(root) {
  mkdirSync(root, { recursive: true });
  const db = new DatabaseSync(path.join(root, "album.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > 2) throw new Error("数据库版本高于此程序，请使用更新版本。");
  if (version === 0)
    db.exec(`
    BEGIN;
    CREATE TABLE media (
      id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('photo','video')), mime TEXT NOT NULL,
      original TEXT NOT NULL, thumbnail TEXT, preview TEXT,
      taken_at TEXT NOT NULL, archive_date TEXT NOT NULL, date_source TEXT NOT NULL, imported_at TEXT NOT NULL,
      width INTEGER, height INTEGER, duration REAL, bytes INTEGER NOT NULL,
      latitude REAL, longitude REAL, location TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]', favorite INTEGER NOT NULL DEFAULT 0,
      warning TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_media_taken_at ON media(taken_at DESC);
    CREATE INDEX idx_media_archive_date ON media(archive_date);
    CREATE TABLE comments (
      id INTEGER PRIMARY KEY, media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
      author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX idx_comments_media_id ON comments(media_id, id);
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT NOT NULL, finished_at TEXT, total INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0, imported INTEGER NOT NULL DEFAULT 0,
      duplicates INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
      current_file TEXT, error TEXT
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id),
      source_path TEXT NOT NULL, name TEXT NOT NULL, mtime REAL NOT NULL,
      managed INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'queued', error TEXT
    );
    CREATE INDEX idx_tasks_state ON tasks(state, id);
    CREATE TABLE sources (path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime REAL NOT NULL);
    CREATE TABLE sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings VALUES ('albumName', '我们的小日子'), ('autoImport', 'true'), ('scanSeconds', '60');
    PRAGMA user_version=2;
    COMMIT;
  `);
  if (version === 1) {
    db.prepare("VACUUM INTO ?").run(path.join(root, `album-before-v2-${Date.now()}.sqlite`));
    db.exec("BEGIN");
    try {
      if (
        !db
          .prepare("PRAGMA table_info(media)")
          .all()
          .some((c) => c.name === "archive_date")
      )
        db.exec("ALTER TABLE media ADD COLUMN archive_date TEXT NOT NULL DEFAULT ''");
      for (const row of db.prepare("SELECT id,taken_at FROM media").all())
        db.prepare("UPDATE media SET archive_date=? WHERE id=?").run(
          new Date(row.taken_at).toLocaleDateString("en-CA", {
            timeZone: process.env.TZ || "Asia/Shanghai",
          }),
          row.id,
        );
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_media_archive_date ON media(archive_date); PRAGMA user_version=2; COMMIT;",
      );
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return db;
}

export function settings(db) {
  return Object.fromEntries(
    db
      .prepare(
        "SELECT key,value FROM settings WHERE key IN ('albumName','autoImport','scanSeconds')",
      )
      .all()
      .map((r) => [r.key, JSON.parse(r.key === "albumName" ? JSON.stringify(r.value) : r.value)]),
  );
}
export function serializeMedia(row) {
  if (!row) return null;
  const { original, thumbnail, preview, hash, ...safe } = row;
  return {
    ...safe,
    tags: JSON.parse(row.tags),
    favorite: Boolean(row.favorite),
    thumbnailUrl: thumbnail ? `/api/media/${row.id}/thumbnail` : null,
    previewUrl: preview ? `/api/media/${row.id}/preview` : null,
    originalUrl: `/api/media/${row.id}/original`,
  };
}
