import { useCallback, useEffect, useRef, useState } from "react";
import { Adb, AdbDaemonTransport, LinuxFileType } from "@yume-chan/adb";
import {
  AdbDaemonWebUsbDeviceManager,
  type AdbDaemonWebUsbDevice,
} from "@yume-chan/adb-daemon-webusb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  AlertCircle,
  CheckCircle2,
  CircleStop,
  CloudUpload,
  FolderSearch,
  Images,
  ListChecks,
  LoaderCircle,
  Smartphone,
  Usb,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const mediaExt = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif", ".avif", ".tif", ".tiff",
  ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".3gp", ".avi",
]);
const thumbExt = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const presets = [
  { label: "整机", path: "/sdcard" },
  { label: "相机", path: "/sdcard/DCIM" },
  { label: "截图", path: "/sdcard/Pictures/Screenshots" },
  { label: "微信", path: "/sdcard/Pictures/WeiXin" },
];
const formatBytes = (n: number) =>
  n >= 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(1)} GB`
    : n >= 1024 ** 2
      ? `${(n / 1024 ** 2).toFixed(1)} MB`
      : `${Math.round(n / 1024)} KB`;
const extOf = (name: string) => name.slice(name.lastIndexOf(".")).toLowerCase();
const formatEta = (sec: number) =>
  !Number.isFinite(sec) || sec <= 0
    ? "…"
    : sec < 90
      ? `约 ${Math.max(1, Math.round(sec))} 秒`
      : `约 ${Math.round(sec / 60)} 分钟`;

type Phase =
  | "blocked"
  | "guide"
  | "connecting"
  | "connected"
  | "scanning"
  | "scanned"
  | "importing"
  | "done";
type ScanStats = { dirs: number; files: number; bytes: number; skippedDirs: number };
type PhoneFile = { path: string; name: string; size: number; mtime: number };
type Progress = {
  index: number;
  total: number;
  doneBytes: number;
  fileBytes: number;
  currentName: string;
  speed: number;
  avgSpeed: number;
  imported: number;
  duplicates: number;
  failures: { name: string; error: string }[];
};
type Thumb = { url: string; name: string };

export default function PhoneImport() {
  const supported =
    typeof window !== "undefined" &&
    window.isSecureContext &&
    AdbDaemonWebUsbDeviceManager.BROWSER !== undefined;
  const [phase, setPhase] = useState<Phase>(supported ? "guide" : "blocked");
  const [error, setError] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [source, setSource] = useState("/sdcard");
  const [stats, setStats] = useState<ScanStats>({ dirs: 0, files: 0, bytes: 0, skippedDirs: 0 });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const [stopped, setStopped] = useState(false);
  const adbRef = useRef<Adb | null>(null);
  const deviceRef = useRef<AdbDaemonWebUsbDevice | null>(null);
  const filesRef = useRef<PhoneFile[]>([]);
  const knownRef = useRef(new Set<string>());
  const scanningRef = useRef(false);
  const stopRef = useRef(false);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const thumbsRef = useRef<Thumb[]>([]);
  const lastPaintRef = useRef(0);

  const resetToGuide = useCallback((message: string) => {
    adbRef.current = null;
    deviceRef.current = null;
    setDeviceName("");
    setPhase("guide");
    setError(message);
  }, []);

  const updateThumbs = useCallback((fn: (ts: Thumb[]) => Thumb[]) => {
    setThumbs((ts) => {
      const next = fn(ts);
      thumbsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    document.title = "围炉 · 手机导入";
    return () => thumbsRef.current.forEach((t) => URL.revokeObjectURL(t.url));
  }, []);

  async function connect() {
    const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
    if (!manager) return;
    setPhase("connecting");
    setError("");
    try {
      const device = await manager.requestDevice();
      if (!device) {
        setPhase("guide");
        return;
      }
      const connection = await device.connect();
      const transport = await AdbDaemonTransport.authenticate({
        serial: device.serial,
        connection,
        credentialStore: new AdbWebCredentialStore("Hearth"),
      });
      adbRef.current = new Adb(transport);
      deviceRef.current = device;
      setDeviceName(device.name || device.serial);
      setPhase("connected");
      transport.disconnected.then(() => resetToGuide("手机已断开连接。"));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/claim|busy|Unable to|in use|already/i.test(message))
        resetToGuide("手机的 USB 接口被其他程序占用。请关闭其他导入向导窗口和手机助手类软件，拔插一次数据线后重试。");
      else if (/auth|unauthorized/i.test(message))
        resetToGuide("手机尚未授权这台电脑。请在手机弹出的「允许 USB 调试」对话框中勾选并允许。");
      else resetToGuide(`连接失败：${message}`);
    }
  }

  async function scan() {
    const adb = adbRef.current;
    if (!adb || scanningRef.current) return;
    scanningRef.current = true;
    setPhase("scanning");
    setError("");
    setProgress(null);
    setStopped(false);
    const current: ScanStats = { dirs: 0, files: 0, bytes: 0, skippedDirs: 0 };
    const found: PhoneFile[] = [];
    const paintScan = () => {
      const now = Date.now();
      if (now - lastPaintRef.current > 150) {
        lastPaintRef.current = now;
        setStats({ ...current });
      }
    };
    const sync = await adb.sync();
    try {
      const walk = async (dir: string): Promise<void> => {
        let entries;
        try {
          entries = await sync.readdir(dir);
        } catch {
          current.skippedDirs++;
          return;
        }
        current.dirs++;
        paintScan();
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const child = `${dir.replace(/\/$/, "")}/${entry.name}`;
          if (entry.type === LinuxFileType.Directory) await walk(child);
          else if (entry.type === LinuxFileType.File && mediaExt.has(extOf(entry.name))) {
            current.files++;
            current.bytes += Number(entry.size);
            paintScan();
            found.push({
              path: child,
              name: entry.name,
              size: Number(entry.size),
              mtime: Number(entry.mtime),
            });
          }
        }
      };
      const target = source.trim().replace(/\/+$/, "") || "/";
      if (!(await sync.isDirectory(target))) {
        setPhase("connected");
        setError(
          `手机上找不到「${target}」这个目录。手机存储区分大小写，请对照预设按钮检查拼写（比如 DCIM 不能写成 dcim）。`,
        );
        return;
      }
      await walk(target);
      filesRef.current = found;
      setStats({ ...current });
      setPhase("scanned");
    } catch (e) {
      resetToGuide(`扫描失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      scanningRef.current = false;
      await sync.dispose().catch(() => {});
    }
  }

  async function hashCheck(hash: string): Promise<boolean> {
    if (knownRef.current.has(hash)) return true;
    const res = await fetch("/api/media/hash-check", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-MyMoment": "1" },
      body: JSON.stringify({ hashes: [hash] }),
    });
    if (res.status === 401) {
      window.dispatchEvent(new Event("session-expired"));
      throw new Error("登录已过期，请重新登录后再导入");
    }
    if (!res.ok) throw new Error("查重请求失败");
    const { existing } = (await res.json()) as { existing: string[] };
    existing.forEach((h) => knownRef.current.add(h));
    return existing.includes(hash);
  }

  function uploadBlob(blob: Blob, name: string, mtimeMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", "/api/import/upload");
      xhr.setRequestHeader("X-MyMoment", "1");
      xhr.onerror = () => reject(new Error("网络中断，请重试"));
      xhr.onabort = () => reject(new Error("已手动停止"));
      xhr.onload = () => {
        if (xhr.status === 401) {
          window.dispatchEvent(new Event("session-expired"));
          reject(new Error("登录已过期，请重新登录后再导入"));
          return;
        }
        try {
          const r = JSON.parse(xhr.responseText);
          xhr.status < 300 ? resolve() : reject(new Error(r.error || "上传失败"));
        } catch {
          reject(new Error("服务器返回异常"));
        }
      };
      const form = new FormData();
      form.append("file", blob, name);
      form.append("lastModified", String(Math.round(mtimeMs)));
      xhr.send(form);
    });
  }

  function stop() {
    stopRef.current = true;
    xhrRef.current?.abort();
  }

  async function importFiles() {
    const adb = adbRef.current;
    const files = filesRef.current;
    if (!adb || !files.length) return;
    stopRef.current = false;
    setStopped(false);
    setError("");
    updateThumbs((ts) => {
      ts.forEach((t) => URL.revokeObjectURL(t.url));
      return [];
    });
    const prog: Progress = {
      index: 0,
      total: files.length,
      doneBytes: 0,
      fileBytes: 0,
      currentName: "",
      speed: 0,
      avgSpeed: 0,
      imported: 0,
      duplicates: 0,
      failures: [],
    };
    setProgress({ ...prog });
    setPhase("importing");
    const startTime = Date.now();
    let windowBytes = 0;
    let windowStart = startTime;
    const paint = (force = false) => {
      const now = Date.now();
      if (force || now - lastPaintRef.current > 150) {
        const dt = (now - windowStart) / 1000;
        if (dt > 0.2) {
          prog.speed = windowBytes / dt;
          windowBytes = 0;
          windowStart = now;
        }
        lastPaintRef.current = now;
        setProgress({ ...prog, failures: [...prog.failures] });
      }
    };
    const sync = await adb.sync();
    try {
      for (let i = 0; i < files.length; i++) {
        if (stopRef.current) break;
        const f = files[i];
        prog.index = i + 1;
        prog.currentName = f.name;
        prog.fileBytes = 0;
        paint(true);
        try {
          const hasher = sha256.create();
          const parts: Uint8Array[] = [];
          const reader = sync.read(f.path).getReader();
          try {
            for (;;) {
              if (stopRef.current) {
                await reader.cancel().catch(() => {});
                break;
              }
              const { done, value } = await reader.read();
              if (done) break;
              if (value?.length) {
                hasher.update(value);
                parts.push(value);
                prog.fileBytes += value.length;
                windowBytes += value.length;
                paint();
              }
            }
          } finally {
            reader.releaseLock();
          }
          if (stopRef.current) break;
          if (f.size > 2 * 1024 ** 3) throw new Error("单个文件不能超过 2 GB");
          const hash = bytesToHex(hasher.digest());
          if (await hashCheck(hash)) {
            prog.duplicates++;
            parts.length = 0;
          } else {
            const blob = new Blob(parts as unknown as BlobPart[]);
            parts.length = 0;
            if (thumbExt.has(extOf(f.name)) && f.size < 50 * 1024 ** 2) {
              updateThumbs((ts) => {
                const next = [...ts, { url: URL.createObjectURL(blob), name: f.name }];
                if (next.length > 24) URL.revokeObjectURL(next.shift()!.url);
                return next;
              });
            }
            await uploadBlob(blob, f.name, f.mtime * 1000);
            knownRef.current.add(hash);
            prog.imported++;
          }
          prog.doneBytes += f.size;
          paint(true);
        } catch (e) {
          if (stopRef.current) break;
          prog.failures.push({ name: f.name, error: e instanceof Error ? e.message : String(e) });
          prog.doneBytes += prog.fileBytes;
          paint(true);
        }
      }
    } catch (e) {
      resetToGuide(`导入中断：${e instanceof Error ? e.message : String(e)}`);
      return;
    } finally {
      await sync.dispose().catch(() => {});
    }
    setStopped(stopRef.current);
    prog.avgSpeed = prog.doneBytes / Math.max(1, (Date.now() - startTime) / 1000);
    paint(true);
    setPhase("done");
  }

  const totalBytes = stats.bytes || 0;
  const pct =
    progress && progress.total
      ? Math.min(
          100,
          Math.round((((progress.doneBytes + progress.fileBytes) / (totalBytes || 1)) * 100) || 0),
        )
      : 0;

  return (
    <main className="phone-import-page">
      <header className="phone-import-head">
        <span className="phone-import-logo">
          <Smartphone size={22} />
        </span>
        <div>
          <h1>手机导入</h1>
          <p>通过数据线把手机里的照片和视频收进家庭相册</p>
        </div>
      </header>

      {phase === "blocked" && (
        <section className="phone-card">
          <AlertCircle size={20} />
          <div>
            <h3>当前浏览器无法使用</h3>
            <p>
              请在这台电脑上用 <b>Chrome 或 Edge</b> 打开
              <code>http://localhost:3080</code>
              再进入本页。局域网地址和其他浏览器不支持直接读取 USB 设备。
            </p>
          </div>
        </section>
      )}

      {phase !== "blocked" && (
        <>
          <section className={`phone-card ${phase !== "guide" && phase !== "connecting" ? "done" : ""}`}>
            <span className="phone-card-icon">
              {phase !== "guide" && phase !== "connecting" ? (
                <CheckCircle2 size={20} />
              ) : (
                <Usb size={20} />
              )}
            </span>
            <div>
              <h3>第 1 步 · 开启手机的 USB 调试</h3>
              <ol>
                <li>手机「设置 → 关于本机 → 版本信息」，连续点击「版本号」直到提示已进入开发者模式</li>
                <li>回到「设置 → 其他设置 → 开发者选项」，打开「USB 调试」</li>
                <li>用数据线连接手机和这台电脑</li>
              </ol>
              {(phase === "guide" || phase === "connecting") && (
                <Button onClick={connect} disabled={phase === "connecting"}>
                  {phase === "connecting" ? (
                    <LoaderCircle className="spin" />
                  ) : (
                    <Smartphone />
                  )}
                  {phase === "connecting" ? "等待选择手机…" : "连接手机"}
                </Button>
              )}
              {phase !== "guide" && phase !== "connecting" && (
                <p className="phone-device">已连接：{deviceName}</p>
              )}
            </div>
          </section>

          {phase !== "guide" && phase !== "connecting" && (
            <section className={`phone-card ${phase === "importing" || phase === "done" ? "done" : ""}`}>
              <span className="phone-card-icon">
                {phase === "importing" || phase === "done" ? (
                  <CheckCircle2 size={20} />
                ) : (
                  <FolderSearch size={20} />
                )}
              </span>
              <div>
                <h3>第 2 步 · 选择导入范围并扫描</h3>
                <div className="phone-presets">
                  {presets.map((p) => (
                    <button
                      key={p.path}
                      className={source === p.path ? "active" : ""}
                      onClick={() => setSource(p.path)}
                      disabled={phase === "scanning" || phase === "importing"}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <input
                  className="phone-source"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  disabled={phase === "scanning" || phase === "importing"}
                  placeholder="/sdcard"
                />
                <Button
                  onClick={scan}
                  disabled={
                    phase === "scanning" || phase === "importing" || !source.startsWith("/")
                  }
                >
                  {phase === "scanning" ? <LoaderCircle className="spin" /> : <Images />}
                  {phase === "scanning" ? "正在扫描手机…" : "开始扫描"}
                </Button>
              </div>
            </section>
          )}

          {(phase === "scanning" || phase === "scanned") && (
            <section className={`phone-card ${phase === "scanned" ? "done" : ""}`}>
              <span className="phone-card-icon">
                {phase === "scanned" ? (
                  <CheckCircle2 size={20} />
                ) : (
                  <LoaderCircle className="spin" size={20} />
                )}
              </span>
              <div>
                <h3>{phase === "scanned" ? "扫描完成" : "扫描中"}</h3>
                <p className="phone-stats">
                  已找到 <b>{stats.files}</b> 个媒体文件，共 <b>{formatBytes(stats.bytes)}</b>
                  <small>
                    （扫描了 {stats.dirs} 个目录
                    {stats.skippedDirs ? `，${stats.skippedDirs} 个无权限目录已跳过` : ""}）
                  </small>
                </p>
                {phase === "scanned" && stats.files > 0 && (
                  <Button onClick={importFiles}>
                    <CloudUpload />
                    开始导入这 {stats.files} 个文件
                  </Button>
                )}
                {phase === "scanned" && stats.files === 0 && (
                  <p className="phone-note">这个范围里没找到照片或视频，换个目录再扫描试试。</p>
                )}
              </div>
            </section>
          )}

          {(phase === "importing" || phase === "done") && progress && (
            <section className={`phone-card ${phase === "done" ? "done" : ""}`}>
              <span className="phone-card-icon">
                {phase === "done" ? (
                  <CheckCircle2 size={20} />
                ) : (
                  <CloudUpload size={20} />
                )}
              </span>
              <div style={{ flex: 1 }}>
                <h3>
                  {phase === "done"
                    ? stopped
                      ? "已停止导入"
                      : "导入完成"
                    : "第 3 步 · 正在导入"}
                </h3>
                <div className="phone-progress-bar">
                  <i style={{ width: `${phase === "done" && !stopped ? 100 : pct}%` }} />
                </div>
                <div className="phone-progress-meta">
                  <span>
                    {progress.index} / {progress.total} 个文件 · {pct}%
                  </span>
                  <span>
                    {formatBytes(progress.doneBytes + progress.fileBytes)} / {formatBytes(totalBytes)}
                  </span>
                </div>
                {phase === "importing" && progress.speed > 0 && (
                  <div className="phone-progress-meta">
                    <span>当前速度 {formatBytes(progress.speed)}/s</span>
                    <span>
                      预计剩余{" "}
                      {formatEta(
                        (totalBytes - progress.doneBytes - progress.fileBytes) / progress.speed,
                      )}
                    </span>
                  </div>
                )}
                {phase === "importing" && (
                  <p className="phone-current">{progress.currentName}</p>
                )}
                <p className="phone-stats">
                  新导入 <b>{progress.imported}</b> 个 · 已在相册中跳过 <b>{progress.duplicates}</b> 个
                  {progress.failures.length > 0 && (
                    <>
                      {" "}· 失败 <b>{progress.failures.length}</b> 个
                    </>
                  )}
                  {phase === "done" && progress.avgSpeed > 0 && (
                    <small>
                      平均速度 {formatBytes(progress.avgSpeed)}/s
                      {progress.avgSpeed < 45 * 1024 ** 2 &&
                        "，偏慢——数据线或接口可能只有 USB 2.0，换电脑后置标 SS 的接口或更粗的原装线会快很多"}
                    </small>
                  )}
                </p>
                {phase === "importing" && (
                  <Button variant="outline" onClick={stop}>
                    <CircleStop />
                    停止导入
                  </Button>
                )}
                {phase === "done" && (
                  <>
                    {progress.failures.length > 0 && (
                      <ul className="phone-fails">
                        {progress.failures.slice(0, 10).map((f, i) => (
                          <li key={i}>
                            {f.name}：{f.error}
                          </li>
                        ))}
                        {progress.failures.length > 10 && (
                          <li>…以及另外 {progress.failures.length - 10} 个</li>
                        )}
                      </ul>
                    )}
                    <p className="phone-note">
                      文件已进入整理队列，可在主窗口的「整理动态」里查看入库进度；视频转码需要一些时间。
                    </p>
                    <div className="phone-actions">
                      <Button
                        onClick={() => {
                          setPhase("connected");
                          setProgress(null);
                          updateThumbs((ts) => {
                            ts.forEach((t) => URL.revokeObjectURL(t.url));
                            return [];
                          });
                        }}
                      >
                        <ListChecks />
                        再导一批
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </section>
          )}

          {phase === "importing" && thumbs.length > 0 && (
            <section className="phone-card">
              <div style={{ flex: 1 }}>
                <h3>刚导入的照片</h3>
                <div className="phone-thumbs">
                  {thumbs.map((t) => (
                    <img key={t.url} src={t.url} alt={t.name} />
                  ))}
                </div>
              </div>
            </section>
          )}

          {error && (
            <section className="phone-card error">
              <AlertCircle size={20} />
              <div>
                <h3>遇到问题</h3>
                <p>{error}</p>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
