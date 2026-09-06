import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createApplication } from "../server/app.mjs";
import { runProcess, chooseDate } from "../server/importer.mjs";
import { parseArgs, quoteRemote } from "../scripts/android-import.mjs";
import { locate } from "../server/geo.mjs";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

let runtime, server, base, cookie, root, photo, photoId, videoId;
const password = "test-family-password-2026";
const headers = () => ({ "X-MyMoment": "1", Cookie: cookie || "" });
async function request(url, body, method = "POST") {
  return fetch(base + url, {
    method,
    headers: { ...headers(), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function get(url) {
  return (await fetch(base + url, { headers: headers() })).json();
}
async function waitJob(id) {
  for (let n = 0; n < 600; n++) {
    const jobs = runtime.db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
    if (["completed", "partial"].includes(jobs.state)) return jobs;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Job timed out");
}
async function upload(buffer, name) {
  const form = new FormData();
  form.append("file", new Blob([buffer]), name);
  form.append("lastModified", String(new Date("2024-02-03T12:00:00Z").getTime()));
  const response = await fetch(base + "/api/import/upload", {
    method: "POST",
    headers: headers(),
    body: form,
  });
  assert.equal(response.status, 202);
  return waitJob((await response.json()).jobId);
}
before(async () => {
  await fs.mkdir("test-output", { recursive: true });
  root = await fs.mkdtemp(path.resolve("test-output", "album-"));
  runtime = await createApplication({
    password,
    dataDir: path.join(root, "data"),
    importDir: path.join(root, "inbox"),
  });
  runtime.db.prepare("UPDATE settings SET value='false' WHERE key='autoImport'").run();
  server = runtime.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  photo = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#285f78" } })
    .jpeg()
    .withExif({
      IFD0: { Artist: "Integration test" },
      IFD2: { DateTimeOriginal: "2024:06:15 12:34:56" },
    })
    .toBuffer();
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (runtime) await runtime.close();
});

test("private data and uploads require a session; write requests require CSRF header", async () => {
  assert.equal((await fetch(base + "/api/media")).status, 401);
  assert.equal((await fetch(base + "/api/import/upload", { method: "POST" })).status, 403);
  assert.equal((await fetch(base + "/api/settings")).status, 401);
  assert.equal((await request("/api/login", { password: "wrong" })).status, 401);
  const login = await request("/api/login", { password });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  assert.match(login.headers.get("set-cookie"), /SameSite=Strict/);
  cookie = login.headers.get("set-cookie").split(";")[0];
  const denied = await fetch(base + "/api/settings", {
    method: "PATCH",
    headers: { ...headers(), Origin: "http://other-host", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(denied.status, 403);
});
test("photo upload extracts EXIF date, preserves original, makes preview and deduplicates", async () => {
  const job = await upload(photo, "周末照片.jpg");
  assert.equal(job.imported, 1);
  assert.equal(job.failed, 0);
  const list = await get("/api/media");
  assert.equal(list.total, 1);
  const m = list.items[0];
  photoId = m.id;
  assert.equal(m.name, "周末照片.jpg");
  assert.equal(m.date_source, "metadata");
  assert.equal(m.archive_date, "2024-06-15");
  assert.ok(m.previewUrl);
  assert.ok(m.thumbnailUrl);
  assert.equal(m.original, undefined);
  assert.equal(m.hash, undefined);
  const original = await fetch(base + m.originalUrl, { headers: headers() });
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), photo);
  assert.match(original.headers.get("content-disposition"), /attachment/);
  const thumb = await fetch(base + m.thumbnailUrl, { headers: headers() });
  assert.equal(thumb.status, 200);
  assert.match(thumb.headers.get("content-type"), /image\/jpeg/);
  assert.equal((await fetch(base + m.thumbnailUrl)).status, 401);
  const duplicate = await upload(photo, "another-name.jpg");
  assert.equal(duplicate.duplicates, 1);
  assert.equal((await get("/api/media")).total, 1);
});
test("hash-check reports which hashes already exist and rejects malformed input", async () => {
  const digest = createHash("sha256").update(photo).digest("hex");
  const found = await request("/api/media/hash-check", {
    hashes: [digest, digest, "0".repeat(64)],
  });
  assert.equal(found.status, 200);
  assert.deepEqual((await found.json()).existing, [digest]);
  assert.equal((await request("/api/media/hash-check", { hashes: ["xyz"] })).status, 400);
  assert.equal(
    (
      await fetch(base + "/api/media/hash-check", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ hashes: [digest] }),
      })
    ).status,
    403,
  );
});
test("GPS coordinates reverse-geocode to province, city and district offline", () => {
  assert.equal(locate(30.245, 120.135), "浙江省 · 杭州市 · 西湖区");
  assert.equal(locate(39.9219, 116.4435), "北京市 · 朝阳区");
  assert.equal(locate(23.043, 113.763), "广东省 · 东莞市");
  assert.equal(locate(35.6762, 139.6503), "");
  assert.equal(locate(NaN, 0), "");
});
test("network endpoint requires a session and lists LAN IPv4 addresses", async () => {
  assert.equal((await fetch(base + "/api/network")).status, 401);
  const res = await fetch(base + "/api/network", { headers: headers() });
  assert.equal(res.status, 200);
  const { addresses } = await res.json();
  assert.ok(Array.isArray(addresses));
  assert.ok(addresses.every((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a)));
  assert.ok(!addresses.includes("127.0.0.1"));
});
test("tags, favorites, locations and comments persist with validation and grouped retrieval", async () => {
  const patch = await request(
    `/api/media/${photoId}`,
    { tags: ["旅行", "家庭", "旅行"], location: "杭州 · 西湖", favorite: true },
    "PATCH",
  );
  assert.equal(patch.status, 200);
  assert.equal((await get("/api/media?tag=" + encodeURIComponent("旅行"))).total, 1);
  assert.equal((await get("/api/media?favorite=true")).total, 1);
  assert.equal((await get("/api/media?month=2024-06")).total, 1);
  assert.equal((await get("/api/media?month=2023-01")).total, 0);
  assert.equal((await get("/api/media?place=" + encodeURIComponent("杭州 · 西湖"))).total, 1);
  assert.equal((await get("/api/albums?group=tag")).items.length, 2);
  assert.equal((await get("/api/albums?group=place")).items[0].key, "杭州 · 西湖");
  assert.equal(
    (
      await request(`/api/comments/${photoId}`, {
        author: "家人",
        body: "<script>不会被当作 HTML 执行</script>",
      })
    ).status,
    201,
  );
  assert.equal((await get(`/api/comments/${photoId}`)).items[0].author, "家人");
  assert.equal((await request(`/api/comments/${photoId}`, { author: "", body: "" })).status, 400);
  assert.equal((await request(`/api/media/${photoId}`, { tags: [1] }, "PATCH")).status, 400);
  assert.equal(
    (await request("/api/settings", { albumName: "家", autoImport: true, scanSeconds: 1 }, "PATCH"))
      .status,
    400,
  );
  assert.deepEqual(Object.keys(await get("/api/settings")).sort(), [
    "albumName",
    "autoImport",
    "scanSeconds",
  ]);
});
test("folder scan is recursive, ignores incomplete files, and does not requeue unchanged sources", async () => {
  const folder = path.join(root, "inbox", "DCIM");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "same.jpg"), photo);
  await fs.utimes(path.join(folder, "same.jpg"), 0, 1700000000);
  await fs.writeFile(path.join(folder, "ignored.jpg.part"), photo);
  const id = await runtime.importer.scan();
  const job = await waitJob(id);
  assert.equal(job.total, 1);
  assert.equal(job.duplicates, 1);
  assert.equal(await runtime.importer.scan(), null);
  assert.deepEqual(await fs.readFile(path.join(folder, "same.jpg")), photo);
});
test("video import transcodes to browser MP4 and serves byte ranges behind authentication", async () => {
  const video = path.join(root, "fixture.mov");
  await runProcess(process.env.FFMPEG_PATH || "ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x120:r=10",
    "-t",
    "0.6",
    "-metadata",
    "creation_time=2024-07-21T12:00:00Z",
    "-c:v",
    "mpeg4",
    video,
  ]);
  const job = await upload(await fs.readFile(video), "家庭视频.mov");
  assert.equal(job.imported, 1);
  const m = (await get("/api/media?kind=video")).items[0];
  videoId = m.id;
  assert.ok(m.previewUrl);
  assert.equal(m.warning, "");
  const result = await fetch(base + m.previewUrl, {
    headers: { ...headers(), Range: "bytes=0-99" },
  });
  assert.equal(result.status, 206);
  assert.equal((await result.arrayBuffer()).byteLength, 100);
  assert.match(result.headers.get("content-range"), /^bytes 0-99\//);
  const details = JSON.parse(
    await runProcess(process.env.FFPROBE_PATH || "ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-of",
      "json",
      path.join(
        root,
        "data",
        runtime.db.prepare("SELECT preview FROM media WHERE id=?").get(videoId).preview,
      ),
    ]),
  );
  assert.equal(details.streams[0].codec_name, "h264");
});
test("failed import can be retried after fixing its staged source", async () => {
  const job = await upload(Buffer.from("not a video"), "broken.mp4");
  assert.equal(job.failed, 1);
  assert.equal(job.state, "partial");
  const task = runtime.db.prepare("SELECT * FROM tasks WHERE job_id=?").get(job.id);
  const video = runtime.db.prepare("SELECT original FROM media WHERE id=?").get(videoId);
  await fs.copyFile(path.join(root, "data", video.original), task.source_path);
  assert.equal((await request(`/api/jobs/${job.id}/retry`)).status, 200);
  const retried = await waitJob(job.id);
  assert.equal(retried.failed, 0);
  assert.equal(retried.duplicates, 1);
  assert.equal(retried.done, 1);
});
test("restart resumes interrupted work, retains comments, and password rotation invalidates sessions", async () => {
  await new Promise((r) => server.close(r));
  await runtime.close();
  const { openDatabase } = await import("../server/db.mjs");
  const db = openDatabase(path.join(root, "data"));
  const source = path.join(root, "data", "uploads", "recovered.jpg");
  await fs.writeFile(source, photo);
  db.prepare(
    "INSERT INTO jobs(id,source,state,created_at,total) VALUES('interrupted','upload','running',?,1)",
  ).run(new Date().toISOString());
  db.prepare(
    "INSERT INTO tasks(job_id,source_path,name,mtime,managed,state) VALUES('interrupted',?,'recovered.jpg',?,1,'processing')",
  ).run(source, Date.now());
  db.close();
  runtime = await createApplication({
    password: password + "-new",
    dataDir: path.join(root, "data"),
    importDir: path.join(root, "inbox"),
  });
  server = runtime.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  const recovered = await waitJob("interrupted");
  assert.equal(recovered.duplicates, 1);
  assert.equal((await fetch(base + "/api/media", { headers: headers() })).status, 401);
  const login = await request("/api/login", { password: password + "-new" });
  cookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal((await get(`/api/comments/${photoId}`)).items.length, 1);
  assert.equal((await get("/api/media")).total, 2);
});
test("Android path arguments and timezone boundary handling", () => {
  assert.deepEqual(parseArgs([]).sources, ["/sdcard"]);
  assert.deepEqual(
    parseArgs(["--source", "/sdcard/DCIM", "--source", "/sdcard/Pictures"]).sources,
    ["/sdcard/DCIM", "/sdcard/Pictures"],
  );
  assert.throws(() => parseArgs(["--watch", "0"]));
  assert.throws(() => parseArgs(["--source", "relative"]));
  assert.equal(quoteRemote("/sdcard/it's mine; $(no).jpg"), "'/sdcard/it'\\''s mine; $(no).jpg'");
  assert.equal(chooseDate({ creation_time: "2024-06-30T18:00:00Z" }, 0).archive_date, "2024-07-01");
});
test("complete offline backup passes integrity check and restores media and comments", async () => {
  await new Promise((r) => server.close(r));
  server = null;
  await runtime.close();
  runtime = null;
  await fs.writeFile(path.join(root, ".env"), "ALBUM_PASSWORD=test-backup-password-2026\n");
  await new Promise((resolve, reject) =>
    execFile(
      process.execPath,
      [path.resolve("scripts/backup.mjs"), "--local-stopped"],
      { cwd: root, env: { ...process.env, DATA_DIR: path.join(root, "data") }, windowsHide: true },
      (e, out, err) => (e ? reject(new Error(out + err)) : resolve(out)),
    ),
  );
  const name = (await fs.readdir(path.join(root, "backups")))[0];
  const backup = path.join(root, "backups", name);
  assert.equal(await fs.readFile(path.join(backup, "COMPLETE"), "utf8"), "ok\n");
  const restored = await createApplication({
    password,
    dataDir: path.join(backup, "data"),
    importDir: path.join(root, "restored-inbox"),
  });
  try {
    assert.equal(restored.db.prepare("SELECT count(*) AS n FROM media").get().n, 2);
    assert.equal(restored.db.prepare("SELECT count(*) AS n FROM comments").get().n, 1);
    const row = restored.db.prepare("SELECT original FROM media WHERE id=?").get(photoId);
    assert.deepEqual(await fs.readFile(path.join(backup, "data", row.original)), photo);
  } finally {
    await restored.close();
  }
});
