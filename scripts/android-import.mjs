import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const mediaExt = new Set([
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
export const quoteRemote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
export function parseArgs(args) {
  const options = {
    sources: [],
    serial: null,
    watch: 0,
    destination: process.env.IMPORT_DIR || "./inbox",
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--help") return { help: true };
    if (
      !["--source", "--serial", "--watch", "--destination"].includes(flag) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new Error(`参数无效：${flag}`);
    const value = args[++i];
    if (flag === "--source") {
      assertValidSource(value);
      options.sources.push(path.posix.normalize(value));
    } else if (flag === "--serial") options.serial = value;
    else if (flag === "--watch") {
      options.watch = Number(value);
      if (!Number.isInteger(options.watch) || options.watch < 15)
        throw new Error("--watch 至少为 15 秒");
    } else options.destination = value;
  }
  if (!options.sources.length) options.sources = ["/sdcard"];
  return options;
}
export function assertValidSource(value) {
  if (!value.startsWith("/") || /[\x00-\x1f]/.test(value))
    throw new Error("手机目录必须为绝对路径，不能含控制字符");
}
function adb(adbPath, args, allowPartial = false) {
  return new Promise((resolve, reject) =>
    execFile(
      adbPath,
      args,
      { windowsHide: true, encoding: "utf8", maxBuffer: 64 * 1024 ** 2, timeout: 60 * 60 * 1000 },
      (error, stdout, stderr) => {
        if (error && !(allowPartial && stdout))
          reject(
            new Error(
              error.code === "ENOENT"
                ? "找不到 adb，请安装 Android SDK Platform-Tools 并配置 PATH。"
                : stderr.trim() || error.message,
            ),
          );
        else resolve({ stdout, partial: Boolean(error) });
      },
    ),
  );
}
export async function runAndroidImport({
  adbPath = process.env.ADB_PATH || "adb",
  sources = ["/sdcard"],
  serial = null,
  destination = process.env.IMPORT_DIR || "./inbox",
  onEvent = () => {},
  shouldStop = () => false,
} = {}) {
  const emit = (type, data = {}) => onEvent({ type, ...data });
  const { stdout } = await adb(adbPath, ["devices"]);
  const devices = stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[1] === "device")
    .map((parts) => parts[0]);
  if (serial ? !devices.includes(serial) : devices.length !== 1)
    throw new Error("请连接并在手机上允许 USB 调试；连接多台手机时需使用 --serial 指定设备。");
  const serialUsed = serial || devices[0],
    prefix = ["-s", serialUsed],
    destinationRoot = path.resolve(destination);
  await fs.mkdir(destinationRoot, { recursive: true });
  const indexPath = path.join(destinationRoot, ".android-index.json");
  let index = {};
  try {
    index = JSON.parse(await fs.readFile(indexPath, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const files = new Set();
  for (const source of sources) {
    const result = await adb(
      adbPath,
      [
        ...prefix,
        "shell",
        `find ${quoteRemote(source.replace(/\/$/, "") + "/")} -type f -print0 2>/dev/null`,
      ],
      true,
    );
    if (result.partial) emit("warn", { message: "部分目录不可读取，继续导入手机已授权的文件。" });
    for (const file of result.stdout.split("\0"))
      if (mediaExt.has(path.posix.extname(file).toLowerCase())) files.add(file);
  }
  emit("scan", { count: files.size });
  let imported = 0,
    skipped = 0,
    failed = 0,
    position = 0;
  for (const remote of files) {
    if (shouldStop()) break;
    position++;
    try {
      const key = createHash("sha256")
        .update(serialUsed + "\0" + remote)
        .digest("hex");
      const info = (
        await adb(adbPath, [...prefix, "shell", `stat -c '%s|%Y' ${quoteRemote(remote)}`])
      ).stdout.trim();
      const [size, mtime] = info.split("|").map(Number);
      if (!Number.isFinite(size) || !Number.isFinite(mtime))
        throw new Error("无法读取媒体文件大小和修改时间");
      const name = path.posix
        .basename(remote)
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .slice(-150);
      const folder = path.join(destinationRoot, "android", key.slice(0, 2));
      await fs.mkdir(folder, { recursive: true });
      const target = path.join(folder, key.slice(0, 16) + "-" + name);
      const local = await fs.stat(target).catch(() => null);
      if (index[key]?.size === size && index[key]?.mtime === mtime && local?.size === size) {
        skipped++;
        emit("skip", { remote, index: position, total: files.size });
        continue;
      }
      const part = target + ".part";
      emit("file", { remote, index: position, total: files.size });
      await adb(adbPath, [...prefix, "pull", "-a", remote, part]);
      if ((await fs.stat(part)).size !== size) throw new Error("文件传输不完整，下一轮会重试");
      const after = (
        await adb(adbPath, [...prefix, "shell", `stat -c '%s|%Y' ${quoteRemote(remote)}`])
      ).stdout.trim();
      if (after !== info) throw new Error("手机文件仍在写入，下一轮会重试");
      await fs.utimes(part, new Date(), new Date(mtime * 1000));
      await fs.rename(part, target);
      index[key] = { size, mtime };
      await fs.writeFile(indexPath + ".tmp", JSON.stringify(index));
      await fs.rename(indexPath + ".tmp", indexPath);
      imported++;
    } catch (e) {
      failed++;
      emit("error", { remote, message: e.message });
    }
  }
  const result = { imported, skipped, failed, stopped: shouldStop() };
  emit("done", result);
  return result;
}
export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log(
      "npm run android -- [--source /sdcard/DCIM] [--source /sdcard/Pictures] [--serial DEVICE] [--watch 60] [--destination ./inbox]",
    );
    return;
  }
  const dest = path.resolve(options.destination);
  await fs.mkdir(dest, { recursive: true });
  // Only one bridge may update the incremental index at a time. A stale lock is explicit and removable.
  const lock = path.join(dest, ".android-import.lock");
  let handle;
  try {
    handle = await fs.open(lock, "wx");
    await handle.writeFile(String(process.pid));
  } catch (e) {
    if (e.code === "EEXIST")
      throw new Error(
        `已有导入进程或上次异常退出。确认没有导入进程后，删除锁文件 ${lock} 再运行。`,
      );
    throw e;
  }
  const cleanup = async () => {
    await handle.close();
    await fs.unlink(lock).catch(() => {});
  };
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const onEvent = (event) => {
    if (event.type === "scan") console.log(`找到 ${event.count} 个媒体文件，正在检查增量…`);
    else if (event.type === "file") console.log(`导入：${event.remote}`);
    else if (event.type === "warn") console.log(event.message);
    else if (event.type === "error") console.error(`${event.remote}：${event.message}`);
    else if (event.type === "done")
      console.log(
        `本轮完成：${event.imported} 个导入，${event.skipped} 个未变化，${event.failed} 个失败。相册会自动扫描导入目录。`,
      );
  };
  try {
    do {
      try {
        const { failed } = await runAndroidImport({
          sources: options.sources,
          serial: options.serial,
          destination: options.destination,
          onEvent,
        });
        if (failed && !options.watch) process.exitCode = 1;
      } catch (e) {
        if (!options.watch) throw e;
        console.error(e.message);
      }
      if (!options.watch) break;
      console.log(`${options.watch} 秒后再次检查；Ctrl+C 停止。`);
      for (let seconds = 0; seconds < options.watch && !stopping; seconds++)
        await new Promise((r) => setTimeout(r, 1000));
    } while (!stopping);
  } finally {
    await cleanup();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
