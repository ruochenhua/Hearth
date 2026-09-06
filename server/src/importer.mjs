import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import sharp from "sharp";
import exifr from "exifr";
import { settings } from "./db.mjs";
import { locate } from "./geo.mjs";

export const extensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".heic",
  ".heif",
  ".avif",
  ".tif",
  ".tiff",
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
  ".3gp",
  ".avi",
]);
const videoExtensions = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".3gp", ".avi"]);
const mimeTypes = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".3gp": "video/3gpp",
  ".avi": "video/x-msvideo",
};

export function runProcess(command, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "",
      errors = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("媒体处理超时"));
    }, timeout);
    child.stdout.on("data", (d) => {
      output = (output + d.toString()).slice(-2000000);
    });
    child.stderr.on("data", (d) => {
      errors = (errors + d.toString()).slice(-8000);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(output) : reject(new Error(errors.slice(-1000) || `进程退出 ${code}`));
    });
  });
}
const iso = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getFullYear() >= 1900 && date.getFullYear() <= 2200
    ? date.toISOString()
    : null;
};
export function chooseDate(metadata, mtime) {
  const capture = iso(
    metadata?.DateTimeOriginal || metadata?.CreateDate || metadata?.creation_time,
  );
  const taken_at = capture || iso(mtime) || new Date().toISOString();
  return {
    taken_at,
    archive_date: new Date(taken_at).toLocaleDateString("en-CA", {
      timeZone: process.env.TZ || "Asia/Shanghai",
    }),
    date_source: capture ? "metadata" : "file",
  };
}
async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
function safeCoordinate(value, limit) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit
    ? value
    : null;
}

export class Importer {
  constructor(db, dataDir, importDir) {
    this.db = db;
    this.dataDir = dataDir;
    this.importDir = importDir;
    this.running = false;
    this.scanning = false;
    this.stopped = false;
    this.lastScan = 0;
    this.scanError = null;
    this.ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
    this.ffprobe = process.env.FFPROBE_PATH || "ffprobe";
  }
  async init() {
    await Promise.all(
      ["originals", "thumbnails", "previews", "uploads"].map((d) =>
        fs.mkdir(path.join(this.dataDir, d), { recursive: true }),
      ),
    );
    await fs.mkdir(this.importDir, { recursive: true });
    for (const task of this.db
      .prepare("SELECT id,source_path FROM tasks WHERE managed=1 AND state<>'completed'")
      .all()) {
      // Staged uploads stay portable when restoring a Docker archive on another host.
      this.db
        .prepare("UPDATE tasks SET source_path=? WHERE id=?")
        .run(path.join(this.dataDir, "uploads", path.win32.basename(task.source_path)), task.id);
    }
    // Interrupted work is replayed; content hashes make replay idempotent.
    this.db.exec(
      "UPDATE tasks SET state='queued' WHERE state='processing'; UPDATE jobs SET state='queued' WHERE state='running';",
    );
    // A crash between completing the last task and finishing its job must not leave a stuck job.
    for (const job of this.db
      .prepare("SELECT id FROM jobs WHERE state IN ('queued','running')")
      .all())
      this.finishJob(job.id);
    this.timer = setInterval(
      () =>
        this.tick().catch((e) => {
          this.scanError = e.message;
        }),
      1000,
    );
    this.timer.unref();
    this.pump();
  }
  async tick() {
    if (this.stopped) return;
    const config = settings(this.db);
    if (config.autoImport && Date.now() - this.lastScan > config.scanSeconds * 1000)
      await this.scan();
  }
  enqueue(files, source) {
    const id = randomUUID();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare("INSERT INTO jobs(id,source,created_at,total) VALUES(?,?,?,?)")
        .run(id, source, new Date().toISOString(), files.length);
      const insert = this.db.prepare(
        "INSERT INTO tasks(job_id,source_path,name,mtime,managed) VALUES(?,?,?,?,?)",
      );
      for (const f of files) insert.run(id, f.path, f.name, f.mtime, f.managed ? 1 : 0);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    if (!files.length) this.finishJob(id);
    this.pump();
    return id;
  }
  async scan() {
    if (this.scanning) return null;
    this.scanning = true;
    this.lastScan = Date.now();
    try {
      const files = [];
      const pending = new Set(
        this.db
          .prepare("SELECT source_path FROM tasks WHERE state IN ('queued','processing')")
          .all()
          .map((r) => r.source_path),
      );
      const failed = new Map(
        this.db
          .prepare("SELECT source_path,mtime FROM tasks WHERE state='failed'")
          .all()
          .map((r) => [r.source_path, r.mtime]),
      );
      const walk = async (dir) => {
        for (const item of await fs.readdir(dir, { withFileTypes: true })) {
          const file = path.join(dir, item.name);
          if (item.isSymbolicLink() || item.name.startsWith(".")) continue;
          if (item.isDirectory()) await walk(file);
          else if (
            item.isFile() &&
            extensions.has(path.extname(file).toLowerCase()) &&
            !pending.has(file)
          ) {
            const stat = await fs.stat(file);
            if (failed.get(file) === stat.mtimeMs) continue;
            // Ignore files that may still be being copied. Android bridge uses .part + atomic rename.
            if (Date.now() - stat.mtimeMs < 10000) continue;
            const known = this.db.prepare("SELECT size,mtime FROM sources WHERE path=?").get(file);
            if (!known || known.size !== stat.size || known.mtime !== stat.mtimeMs)
              files.push({ path: file, name: item.name, mtime: stat.mtimeMs });
          }
        }
      };
      await walk(this.importDir);
      this.scanError = null;
      return files.length ? this.enqueue(files, "folder") : null;
    } catch (e) {
      this.scanError = e.message;
      throw e;
    } finally {
      this.scanning = false;
    }
  }
  finishJob(id) {
    const pending = this.db
      .prepare(
        "SELECT count(*) AS n FROM tasks WHERE job_id=? AND state IN ('queued','processing')",
      )
      .get(id).n;
    if (!pending)
      this.db
        .prepare(
          "UPDATE jobs SET state=CASE WHEN failed>0 THEN 'partial' ELSE 'completed' END,finished_at=?,current_file=NULL WHERE id=? AND state IN ('queued','running')",
        )
        .run(new Date().toISOString(), id);
  }
  async pump() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (!this.stopped) {
        const task = this.db
          .prepare("SELECT * FROM tasks WHERE state='queued' ORDER BY id LIMIT 1")
          .get();
        if (!task) break;
        this.db.prepare("UPDATE tasks SET state='processing',error=NULL WHERE id=?").run(task.id);
        this.db
          .prepare("UPDATE jobs SET state='running',current_file=? WHERE id=?")
          .run(task.name, task.job_id);
        let result, failure;
        try {
          result = await this.importOne(task);
        } catch (e) {
          failure = e.message;
        }
        this.db.exec("BEGIN");
        try {
          this.db
            .prepare("UPDATE tasks SET state=?,error=? WHERE id=?")
            .run(failure ? "failed" : "completed", failure || null, task.id);
          this.db
            .prepare(
              "UPDATE jobs SET done=done+1,imported=imported+?,duplicates=duplicates+?,failed=failed+?,error=COALESCE(?,error) WHERE id=?",
            )
            .run(
              result === "imported" ? 1 : 0,
              result === "duplicate" ? 1 : 0,
              failure ? 1 : 0,
              failure || null,
              task.job_id,
            );
          this.db.exec("COMMIT");
        } catch (e) {
          this.db.exec("ROLLBACK");
          throw e;
        }
        // Keep failed uploads for explicit retry. Only staging files owned by the server are removed.
        if (task.managed && !failure) await fs.unlink(task.source_path).catch(() => {});
        this.finishJob(task.job_id);
      }
    } catch (e) {
      console.error("Import worker:", e.message);
    } finally {
      this.running = false;
    }
  }
  retry(id) {
    const job = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
    if (!job || !["partial", "completed"].includes(job.state)) return false;
    this.db.exec("BEGIN");
    try {
      const n = this.db
        .prepare("UPDATE tasks SET state='queued',error=NULL WHERE job_id=? AND state='failed'")
        .run(id).changes;
      this.db
        .prepare(
          "UPDATE jobs SET state='queued',done=done-?,failed=0,error=NULL,finished_at=NULL WHERE id=?",
        )
        .run(n, id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    this.finishJob(id);
    this.pump();
    return true;
  }
  async importOne(task) {
    const stat = await fs.lstat(task.source_path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("仅支持普通媒体文件");
    if (!task.managed) {
      const real = await fs.realpath(task.source_path);
      const relative = path.relative(await fs.realpath(this.importDir), real);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("文件超出导入目录");
    }
    const ext = path.extname(task.name).toLowerCase();
    if (!extensions.has(ext)) throw new Error("不支持的文件类型");
    // Process an immutable private snapshot; ongoing folder copies cannot corrupt the archived original.
    const snapshot = path.join(this.dataDir, "uploads", `${randomUUID()}.snapshot${ext}`);
    await fs.copyFile(task.source_path, snapshot);
    try {
      const after = await fs.stat(task.source_path);
      if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs)
        throw new Error("文件仍在写入，请复制完成后重试");
      const hash = await hashFile(snapshot);
      const remember = () => {
        if (!task.managed)
          this.db
            .prepare("INSERT OR REPLACE INTO sources(path,size,mtime) VALUES(?,?,?)")
            .run(task.source_path, stat.size, stat.mtimeMs);
      };
      if (this.db.prepare("SELECT id FROM media WHERE hash=?").get(hash)) {
        remember();
        return "duplicate";
      }
      const video = videoExtensions.has(ext);
      let metadata = {},
        width = null,
        height = null,
        duration = null;
      if (video) {
        const probe = JSON.parse(
          await runProcess(this.ffprobe, [
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
            snapshot,
          ]),
        );
        const stream = probe.streams?.find((s) => s.codec_type === "video");
        if (!stream) throw new Error("文件不包含视频轨道");
        metadata = { ...probe.format?.tags, ...stream.tags };
        width = stream.width;
        height = stream.height;
        duration = Number(probe.format?.duration) || null;
        const gps = String(
          metadata["com.apple.quicktime.location.ISO6709"] || metadata.location || "",
        ).match(/([+-]\d+\.?\d*)([+-]\d+\.?\d*)/);
        if (gps) {
          metadata.latitude = Number(gps[1]);
          metadata.longitude = Number(gps[2]);
        }
      } else {
        metadata =
          (await exifr
            .parse(snapshot, { iptc: true, xmp: true, mergeOutput: true })
            .catch(() => ({}))) || {};
        // libvips may lack HEVC; the Docker image also supplies ffmpeg with HEIF support where available.
        const info = await sharp(snapshot, { limitInputPixels: 100000000 })
          .metadata()
          .catch(() => null);
        width = info?.autoOrient?.width || info?.width || null;
        height = info?.autoOrient?.height || info?.height || null;
      }
      const dates = chooseDate(metadata, task.mtime);
      const month = dates.archive_date.slice(0, 7).replace("-", "/");
      const original = `originals/${month}/${hash}${ext}`;
      const thumbnail = `thumbnails/${hash}.jpg`;
      const preview = `previews/${hash}.${video ? "mp4" : "jpg"}`;
      await fs.mkdir(path.dirname(path.join(this.dataDir, original)), { recursive: true });
      let warning = "",
        hasPreview = false,
        hasThumbnail = false;
      if (video) {
        try {
          await runProcess(
            this.ffmpeg,
            [
              "-y",
              "-v",
              "error",
              "-i",
              snapshot,
              "-map",
              "0:v:0",
              "-map",
              "0:a:0?",
              "-vf",
              "scale='min(1920,iw)':-2",
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-crf",
              "23",
              "-pix_fmt",
              "yuv420p",
              "-c:a",
              "aac",
              "-movflags",
              "+faststart",
              path.join(this.dataDir, preview),
            ],
            7200000,
          );
          hasPreview = true;
          await runProcess(this.ffmpeg, [
            "-y",
            "-v",
            "error",
            "-i",
            path.join(this.dataDir, preview),
            "-frames:v",
            "1",
            "-vf",
            "scale=640:-2",
            path.join(this.dataDir, thumbnail),
          ]);
          hasThumbnail = true;
        } catch {
          warning = "视频预览生成失败；原文件已保存，可下载原片。请检查 FFmpeg 与磁盘空间。";
        }
      } else {
        try {
          await sharp(snapshot, { limitInputPixels: 100000000 })
            .rotate()
            .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 88 })
            .toFile(path.join(this.dataDir, preview));
          hasPreview = true;
        } catch {
          try {
            await runProcess(this.ffmpeg, [
              "-y",
              "-v",
              "error",
              "-i",
              snapshot,
              "-frames:v",
              "1",
              "-vf",
              "scale='min(2400,iw)':-2",
              path.join(this.dataDir, preview),
            ]);
            hasPreview = true;
          } catch {
            warning =
              "无法生成照片预览；原文件已保存。HEIC 支持取决于解码器，可将手机拍摄格式设为 JPEG。";
          }
        }
        if (hasPreview) {
          await sharp(path.join(this.dataDir, preview))
            .resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toFile(path.join(this.dataDir, thumbnail));
          hasThumbnail = true;
        }
      }
      const rawTags = metadata.Keywords || metadata.subject || [];
      const tags = [
        ...new Set(
          (Array.isArray(rawTags) ? rawTags : [rawTags])
            .filter((t) => typeof t === "string")
            .map((t) => t.slice(0, 40)),
        ),
      ].slice(0, 30);
      const latitude = safeCoordinate(metadata.latitude, 90);
      const longitude = safeCoordinate(metadata.longitude, 180);
      const location =
        (latitude !== null && longitude !== null ? locate(latitude, longitude) : "") ||
        [metadata.City, metadata.State, metadata.Country]
          .filter((v) => typeof v === "string")
          .join(" · ")
          .slice(0, 120);
      await fs.rename(snapshot, path.join(this.dataDir, original));
      this.db
        .prepare(`INSERT INTO media(id,hash,name,kind,mime,original,thumbnail,preview,taken_at,archive_date,date_source,imported_at,width,height,duration,bytes,latitude,longitude,location,tags,warning)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          randomUUID(),
          hash,
          task.name,
          video ? "video" : "photo",
          mimeTypes[ext],
          original,
          hasThumbnail ? thumbnail : null,
          hasPreview ? preview : null,
          dates.taken_at,
          dates.archive_date,
          dates.date_source,
          new Date().toISOString(),
          width,
          height,
          duration,
          stat.size,
          latitude,
          longitude,
          location,
          JSON.stringify(tags),
          warning,
        );
      remember();
      return "imported";
    } finally {
      await fs.unlink(snapshot).catch(() => {});
    }
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    while (this.running || this.scanning) await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
