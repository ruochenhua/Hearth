import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const docker = (args) =>
  new Promise((resolve, reject) =>
    execFile("docker", args, { windowsHide: true, encoding: "utf8" }, (e, out, err) =>
      e ? reject(new Error(err || e.message)) : resolve(out.trim()),
    ),
  );
const source = path.resolve(process.env.DATA_DIR || "data");
const root = path.resolve("backups");
const destination = path.join(root, new Date().toISOString().replace(/[:.]/g, "-"));
const relative = path.relative(source, root);
if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative)))
  throw new Error("备份目录不能位于数据目录内");
await fs.access(path.join(source, "album.sqlite"));
const localMode = process.argv.includes("--local-stopped");
let resume = false,
  completed = false;
try {
  if (!localMode) {
    const running = await docker(["compose", "ps", "--status", "running", "--services"]);
    resume = running.split(/\r?\n/).includes("album");
    if (resume) {
      console.log("暂停 Docker 相册，生成一致的完整备份…");
      await docker(["compose", "stop", "album"]);
    }
  }
  // Exclusive lock also detects accidentally running native Node processes. Keep it while copying.
  const db = new DatabaseSync(path.join(source, "album.sqlite"));
  try {
    db.exec("PRAGMA busy_timeout=1000; PRAGMA wal_checkpoint(TRUNCATE); BEGIN EXCLUSIVE;");
    await fs.mkdir(destination, { recursive: true });
    await fs.cp(source, path.join(destination, "data"), {
      recursive: true,
      errorOnExist: true,
      force: false,
      // The checkpoint above emptied WAL. Do not copy Windows-locked shared-memory files.
      filter: (file) => ![path.join(source, "album.sqlite-shm"), path.join(source, "album.sqlite-wal")].includes(file),
    });
    await fs.copyFile(".env", path.join(destination, ".env"));
    await fs.writeFile(
      path.join(destination, "RESTORE.txt"),
      "围炉（Hearth）完整备份。停止服务，将 data 目录复制到空的目标数据目录，恢复 .env（必要时修改路径），再启动相同或更新版本。不要覆盖正在运行的相册。\n",
    );
    db.exec("ROLLBACK");
  } finally {
    db.close();
  }
  const verify = new DatabaseSync(path.join(destination, "data", "album.sqlite"));
  try {
    if (verify.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw new Error("备份数据库完整性检查失败");
  } finally {
    verify.close();
  }
  await fs.writeFile(path.join(destination, "COMPLETE"), "ok\n");
  completed = true;
  console.log(`备份完成：${destination}`);
} finally {
  if (resume) {
    await docker(["compose", "start", "album"]);
    console.log("Docker 相册已恢复运行。");
  }
  if (!completed)
    console.error(
      "备份未完成，请保留现有数据并检查错误；没有 COMPLETE 标记的目录不能当作成功备份。",
    );
}
