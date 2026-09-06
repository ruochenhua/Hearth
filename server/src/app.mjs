import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { openDatabase, settings, serializeMedia } from "./db.mjs";
import { Importer, extensions, runProcess } from "./importer.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const isIpv4 = (value) => {
  if (typeof value !== "string") return false;
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
};
// Docker/容器内部段不作为局域网候选（172.17/16 是网桥，10/8 与 192.168.65/24 常见于容器环境）
const isInternalIp = (ip) =>
  ip === "127.0.0.1" ||
  /^10\./.test(ip) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
  /^169\.254\./.test(ip) ||
  /^192\.168\.65\./.test(ip);
export async function createApplication(config) {
  if (!config.password || config.password.length < 12 || config.password.startsWith("replace-with"))
    throw new Error("请先运行 npm run setup，设置至少 12 位的相册密码。");
  const dataDir = path.resolve(config.dataDir),
    importDir = path.resolve(config.importDir);
  const configuredAddresses = [
    ...new Set(
      (config.networkAddresses || []).filter((ip) => isIpv4(ip) && ip !== "127.0.0.1"),
    ),
  ];
  const overlap = (a, b) => {
    const r = path.relative(a, b);
    return !r || (!r.startsWith("..") && !path.isAbsolute(r));
  };
  if (overlap(dataDir, importDir) || overlap(importDir, dataDir))
    throw new Error("数据目录和导入目录不能相互包含。");
  const db = openDatabase(dataDir);
  const importer = new Importer(db, dataDir, importDir);
  const oldPassword = db.prepare("SELECT value FROM settings WHERE key='_password'").get();
  const credentials = oldPassword
    ? JSON.parse(oldPassword.value)
    : { salt: randomBytes(16).toString("hex") };
  const fingerprint = scryptSync(config.password, credentials.salt, 32).toString("hex");
  if (credentials.hash !== fingerprint) {
    db.exec("DELETE FROM sessions");
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('_password',?)").run(
      JSON.stringify({ ...credentials, hash: fingerprint }),
    );
  }
  await importer.init();
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "blob:", "data:"],
          mediaSrc: ["'self'", "blob:"],
          // The local control agent supplies host LAN addresses when Docker cannot see them.
          connectSrc: ["'self'", "http://127.0.0.1:3090", "http://localhost:3090"],
          upgradeInsecureRequests: null,
        },
      },
      strictTransportSecurity: config.secureCookies ? undefined : false,
    }),
  );
  // 记录客户端实际用来访问本服务的局域网 IP（Host 头是 IP 字面量时）。
  // 容器内枚举网卡只能拿到 Docker 网桥地址，客户端用过的地址才是真正的可达入口。
  const observedHosts = [];
  const rememberHost = (ip) => {
    if (ip && isIpv4(ip) && !isInternalIp(ip) && !observedHosts.includes(ip)) {
      if (observedHosts.length >= 20) observedHosts.shift();
      observedHosts.push(ip);
    }
  };
  app.use((req, _res, next) => {
    rememberHost((req.headers.host || "").match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/)?.[1]);
    rememberHost(req.socket.remoteAddress?.replace(/^::ffff:/, ""));
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/health", (_req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ status: "ok" });
  });
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.get("X-MyMoment") !== "1") return next(bad("请求缺少安全校验", 403));
      const origin = req.get("origin");
      try {
        if (origin && new URL(origin).host !== req.get("host"))
          return next(bad("不允许跨站请求", 403));
      } catch {
        return next(bad("请求来源无效", 403));
      }
    }
    const cookie = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("hearth="))
      ?.slice(7);
    if (cookie && /^[a-f0-9]{64}$/.test(cookie))
      req.session = db
        .prepare("SELECT token FROM sessions WHERE token=? AND expires>?")
        .get(digest(cookie), Date.now());
    next();
  });
  const salt = randomBytes(16),
    passwordHash = scryptSync(config.password, salt, 32);
  app.get("/api/session", (req, res) =>
    res.json({ authenticated: Boolean(req.session), albumName: settings(db).albumName }),
  );
  app.post(
    "/api/login",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 15,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "尝试次数过多，请 15 分钟后重试。" },
    }),
    (req, res) => {
      if (typeof req.body?.password !== "string" || req.body.password.length > 256)
        throw bad("密码格式无效");
      if (!timingSafeEqual(passwordHash, scryptSync(req.body.password, salt, 32)))
        throw bad("相册密码不正确", 401);
      const token = randomBytes(32).toString("hex");
      db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
      db.prepare("INSERT INTO sessions(token,expires) VALUES(?,?)").run(
        digest(token),
        Date.now() + 7 * 86400000,
      );
      res
        .cookie("hearth", token, {
          httpOnly: true,
          sameSite: "strict",
          secure: Boolean(config.secureCookies),
          maxAge: 7 * 86400000,
          path: "/",
        })
        .json({ ok: true });
    },
  );
  app.use("/api", (req, _res, next) => (req.session ? next() : next(bad("请先登录相册", 401))));
  app.post("/api/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token=?").run(req.session.token);
    res
      .clearCookie("hearth", {
        path: "/",
        httpOnly: true,
        sameSite: "strict",
        secure: Boolean(config.secureCookies),
      })
      .json({ ok: true });
  });
  app.get("/api/media", (req, res) => {
    const where = [],
      args = [];
    if (req.query.kind && ["photo", "video"].includes(req.query.kind)) {
      where.push("kind=?");
      args.push(req.query.kind);
    }
    if (req.query.favorite === "true") where.push("favorite=1");
    if (typeof req.query.q === "string" && req.query.q) {
      where.push("(name LIKE ? OR location LIKE ? OR tags LIKE ?)");
      args.push(...Array(3).fill(`%${req.query.q.slice(0, 100)}%`));
    }
    if (typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month)) {
      where.push("archive_date>=? AND archive_date<?");
      args.push(req.query.month, req.query.month + "~");
    }
    if (typeof req.query.tag === "string") {
      where.push("EXISTS(SELECT 1 FROM json_each(media.tags) WHERE value=?)");
      args.push(req.query.tag);
    }
    if (typeof req.query.place === "string") {
      where.push(
        "(CASE WHEN location<>'' THEN location WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN printf('%.2f, %.2f',latitude,longitude) ELSE '未记录地点' END)=?",
      );
      args.push(req.query.place);
    }
    const clause = where.length ? "WHERE " + where.join(" AND ") : "";
    const offset = Math.floor(Math.max(0, Math.min(10000000, Number(req.query.offset) || 0)));
    const limit = Math.floor(Math.max(1, Math.min(100, Number(req.query.limit) || 60)));
    const total = db.prepare(`SELECT count(*) AS n FROM media ${clause}`).get(...args).n;
    const rows = db
      .prepare(`SELECT * FROM media ${clause} ORDER BY taken_at DESC,id LIMIT ? OFFSET ?`)
      .all(...args, limit, offset);
    res.json({ items: rows.map(serializeMedia), total, offset, limit });
  });
  app.get("/api/albums", (req, res) => {
    const group = req.query.group || "month";
    let sql;
    if (group === "tag")
      sql =
        "SELECT value AS key,count(*) AS count,MAX(taken_at) AS latest FROM media,json_each(media.tags) GROUP BY value ORDER BY latest DESC";
    else if (group === "place")
      sql =
        "SELECT CASE WHEN location<>'' THEN location WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN printf('%.2f, %.2f',latitude,longitude) ELSE '未记录地点' END AS key,count(*) AS count,MAX(taken_at) AS latest FROM media GROUP BY key ORDER BY latest DESC";
    else
      sql =
        "SELECT substr(archive_date,1,7) AS key,count(*) AS count,MAX(taken_at) AS latest FROM media GROUP BY key ORDER BY key DESC";
    const albums = db.prepare(sql).all();
    res.json({ items: albums });
  });
  const getMedia = (id) => {
    const row = db.prepare("SELECT * FROM media WHERE id=?").get(id);
    if (!row) throw bad("未找到这份回忆", 404);
    return row;
  };
  app.get("/api/media/:id", (req, res) => res.json(serializeMedia(getMedia(req.params.id))));
  app.get("/api/media/:id/:variant", (req, res, next) => {
    const row = getMedia(req.params.id);
    const variant = req.params.variant;
    if (!["thumbnail", "preview", "original"].includes(variant) || !row[variant])
      throw bad("该文件暂不可用", 404);
    const file = path.resolve(dataDir, row[variant]);
    if (!file.startsWith(dataDir + path.sep)) throw bad("文件路径无效", 403);
    res.set("Cache-Control", "private, max-age=3600");
    if (variant === "original")
      res.download(file, row.name, (e) => {
        if (e) next(e);
      });
    else
      res.sendFile(file, (e) => {
        if (e) next(e);
      });
  });
  app.patch("/api/media/:id", (req, res) => {
    const row = getMedia(req.params.id);
    const { tags, location, favorite } = req.body || {};
    if (
      tags !== undefined &&
      (!Array.isArray(tags) ||
        tags.length > 30 ||
        tags.some((t) => typeof t !== "string" || t.length > 40))
    )
      throw bad("最多 30 个标签，每个不超过 40 字");
    if (location !== undefined && (typeof location !== "string" || location.length > 120))
      throw bad("地点不超过 120 字");
    if (favorite !== undefined && typeof favorite !== "boolean") throw bad("收藏值无效");
    db.prepare("UPDATE media SET tags=?,location=?,favorite=? WHERE id=?").run(
      tags ? JSON.stringify([...new Set(tags.map((t) => t.trim()).filter(Boolean))]) : row.tags,
      location ?? row.location,
      favorite === undefined ? row.favorite : Number(favorite),
      row.id,
    );
    res.json(serializeMedia(getMedia(row.id)));
  });
  app.get("/api/comments/:id", (req, res) => {
    getMedia(req.params.id);
    res.json({
      items: db.prepare("SELECT * FROM comments WHERE media_id=? ORDER BY id").all(req.params.id),
    });
  });
  app.post("/api/comments/:id", (req, res) => {
    getMedia(req.params.id);
    const { author, body } = req.body || {};
    if (
      typeof author !== "string" ||
      !author.trim() ||
      author.length > 30 ||
      typeof body !== "string" ||
      !body.trim() ||
      body.length > 1000
    )
      throw bad("请填写称呼（30 字内）和评论（1000 字内）");
    const result = db
      .prepare("INSERT INTO comments(media_id,author,body,created_at) VALUES(?,?,?,?)")
      .run(req.params.id, author.trim(), body.trim(), new Date().toISOString());
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });
  const upload = multer({
    storage: multer.diskStorage({
      destination: path.join(dataDir, "uploads"),
      filename: (_req, file, cb) =>
        cb(null, randomBytes(20).toString("hex") + path.extname(file.originalname).toLowerCase()),
    }),
    limits: { fileSize: 2 * 1024 ** 3, files: 1, fields: 2, fieldSize: 1024 },
    fileFilter: (_req, file, cb) =>
      cb(
        extensions.has(path.extname(file.originalname).toLowerCase())
          ? null
          : bad("不支持的媒体格式"),
        true,
      ),
  });
  app.post("/api/import/upload", upload.single("file"), async (req, res) => {
    if (!req.file) throw bad("请选择照片或视频");
    try {
      const decoded = Buffer.from(req.file.originalname, "latin1").toString("utf8");
      const name = path.win32
        .basename(decoded.includes("\ufffd") ? req.file.originalname : decoded)
        .slice(0, 240);
      const mtime = Number(req.body?.lastModified);
      const jobId = importer.enqueue(
        [
          {
            path: req.file.path,
            name,
            mtime: Number.isFinite(mtime) && mtime > 0 ? mtime : Date.now(),
            managed: true,
          },
        ],
        "upload",
      );
      res.status(202).json({ jobId });
    } catch (e) {
      await fs.unlink(req.file.path).catch(() => {});
      throw e;
    }
  });
  app.post("/api/media/hash-check", (req, res) => {
    const hashes = req.body?.hashes;
    if (
      !Array.isArray(hashes) ||
      hashes.length > 2000 ||
      hashes.some((h) => typeof h !== "string" || !/^[0-9a-f]{64}$/.test(h))
    )
      throw bad("hashes 必须为不超过 2000 个的 SHA-256 十六进制字符串");
    const stmt = db.prepare("SELECT hash FROM media WHERE hash=?");
    res.json({ existing: [...new Set(hashes)].filter((h) => stmt.get(h)) });
  });
  app.post("/api/import/scan", async (_req, res) => {
    const jobId = await importer.scan();
    res
      .status(202)
      .json({
        jobId,
        message: jobId
          ? "导入任务已加入队列"
          : "没有发现新文件；刚复制的文件会在稳定 10 秒后导入。",
      });
  });
  app.get("/api/jobs", (_req, res) =>
    res.json({
      items: db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50").all(),
      scanError: importer.scanError,
    }),
  );
  app.get("/api/jobs/:id/errors", (req, res) =>
    res.json({
      items: db
        .prepare("SELECT id,name,error FROM tasks WHERE job_id=? AND state='failed'")
        .all(req.params.id),
    }),
  );
  app.post("/api/jobs/:id/retry", (req, res) => {
    if (!importer.retry(req.params.id)) throw bad("任务尚未结束或不存在");
    res.json({ ok: true });
  });
  app.get("/api/settings", (_req, res) => res.json(settings(db)));
  app.patch("/api/settings", (req, res) => {
    const { albumName, autoImport, scanSeconds } = req.body || {};
    if (
      typeof albumName !== "string" ||
      !albumName.trim() ||
      albumName.length > 40 ||
      typeof autoImport !== "boolean" ||
      !Number.isInteger(scanSeconds) ||
      scanSeconds < 15 ||
      scanSeconds > 3600
    )
      throw bad("名称限 1–40 字，扫描间隔为 15–3600 秒");
    db.exec("BEGIN");
    try {
      const update = db.prepare("UPDATE settings SET value=? WHERE key=?");
      update.run(albumName.trim(), "albumName");
      update.run(String(autoImport), "autoImport");
      update.run(String(scanSeconds), "scanSeconds");
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    res.json(settings(db));
  });
  const capabilities = {};
  await Promise.all(
    ["ffmpeg", "ffprobe"].map(async (key) => {
      capabilities[key] = await runProcess(
        key === "ffmpeg" ? importer.ffmpeg : importer.ffprobe,
        ["-version"],
        10000,
      ).then(
        () => true,
        () => false,
      );
    }),
  );
  app.get("/api/network", (_req, res) => {
    const interfaceAddrs = [
      ...new Set(
        Object.values(os.networkInterfaces())
          .flat()
          .filter((a) => a && a.family === "IPv4" && !a.internal)
          .map((a) => a.address)
          .filter((ip) => !isInternalIp(ip)),
      ),
    ];
    res.json({ addresses: [...new Set([...configuredAddresses, ...observedHosts, ...interfaceAddrs])] });
  });
  app.get("/api/stats", async (_req, res) => {
    const totals = db
      .prepare(
        "SELECT count(*) AS total,COALESCE(sum(kind='photo'),0) AS photos,COALESCE(sum(kind='video'),0) AS videos,COALESCE(sum(bytes),0) AS bytes,COALESCE(sum(favorite),0) AS favorites,COALESCE(sum(warning<>''),0) AS warnings FROM media",
      )
      .get();
    const disk = await fs.statfs(dataDir);
    const activeJobs = db
      .prepare("SELECT count(*) AS n FROM jobs WHERE state IN ('queued','running')")
      .get().n;
    res.json({
      ...totals,
      activeJobs,
      freeBytes: disk.bavail * disk.bsize,
      version: "0.1.0",
      schemaVersion: 2,
      capabilities,
      importDir,
      dataDir,
      lastScan: importer.lastScan || null,
      scanError: importer.scanError,
      uptime: process.uptime(),
    });
  });
  app.use("/api", (_req, _res, next) => next(bad("接口不存在", 404)));
  if (config.webDir) {
    app.use(express.static(config.webDir, { index: false }));
    app.get("/{*splat}", (_req, res) => res.sendFile(path.join(config.webDir, "index.html")));
  }
  app.use((err, _req, res, next) => {
    if (res.headersSent) return next(err);
    const status =
      err.code === "LIMIT_FILE_SIZE"
        ? 413
        : err instanceof multer.MulterError
          ? 400
          : err.status || 500;
    if (status === 500) console.error(err);
    res
      .status(status)
      .json({
        error:
          status === 500
            ? "操作失败，请检查服务日志和磁盘空间。"
            : err.code === "LIMIT_FILE_SIZE"
              ? "单个文件最大 2 GB"
              : err.message,
      });
  });
  return {
    app,
    db,
    importer,
    close: async () => {
      await importer.stop();
      db.close();
    },
  };
}
