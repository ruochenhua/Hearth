import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  Images,
  LoaderCircle,
  RefreshCcw,
  Smartphone,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const imageExt = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const formatBytes = (n: number) =>
  n >= 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(1)} GB`
    : n >= 1024 ** 2
      ? `${(n / 1024 ** 2).toFixed(1)} MB`
      : `${Math.round(n / 1024)} KB`;
const extOf = (name: string) => name.slice(name.lastIndexOf(".")).toLowerCase();
const isIpv4 = (host: string) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(host) &&
  host.split(".").every((octet) => Number(octet) <= 255);
const addressesFrom = async (response: Response) => {
  if (!response.ok) return [];
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== "object" || !("addresses" in payload)) return [];
  const addresses = payload.addresses;
  return Array.isArray(addresses) ? addresses.filter((address): address is string => typeof address === "string") : [];
};

type UploadFile = { file: File; size: number };
type Progress = {
  index: number;
  total: number;
  doneBytes: number;
  fileBytes: number;
  currentName: string;
  imported: number;
  duplicates: number;
  failures: { file: File; error: string }[];
};
type Thumb = { url: string; name: string };

export default function MobileUpload() {
  const [phase, setPhase] = useState<"idle" | "uploading" | "done">("idle");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [networkLoading, setNetworkLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  const stopRef = useRef(false);
  const totalBytesRef = useRef(0);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const thumbsRef = useRef<Thumb[]>([]);
  const lastPaintRef = useRef(0);

  const isMobile =
    typeof navigator !== "undefined" &&
    /Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent);

  const updateThumbs = useCallback((fn: (ts: Thumb[]) => Thumb[]) => {
    setThumbs((ts) => {
      const next = fn(ts);
      thumbsRef.current = next;
      return next;
    });
  }, []);

  const loadNetwork = useCallback(async () => {
    if (isMobile) return;
    setNetworkLoading(true);
    try {
      let addresses: string[] = [];
      try {
        const response = await fetch("/api/network", {
          cache: "no-store",
          headers: { "X-MyMoment": "1" },
        });
        addresses = await addressesFrom(response);
      } catch {
        // The control agent below is an optional fallback.
      }
      if (!addresses.length) {
        try {
          const response = await fetch("http://127.0.0.1:3090/api/status", { cache: "no-store" });
          addresses = await addressesFrom(response);
        } catch {
          // The album can also run without the local control agent.
        }
      }
      const here = window.location.hostname;
      const port = window.location.port;
      const candidates = [
        ...(isIpv4(here) && here !== "127.0.0.1" ? [here] : []),
        ...addresses.filter((address): address is string => isIpv4(address) && address !== "127.0.0.1"),
      ];
      const urls = [...new Set(candidates)]
        .slice(0, 3)
        .map(
          (ip) =>
            `${window.location.protocol}//${ip}${port ? `:${port}` : ""}/?assistant=upload`,
        );
      setLinks(urls);
    } finally {
      setNetworkLoading(false);
    }
  }, [isMobile]);

  useEffect(() => {
    document.title = "围炉 · 手机快传";
    void loadNetwork();
    return () => thumbsRef.current.forEach((t) => URL.revokeObjectURL(t.url));
  }, [loadNetwork]);

  useEffect(() => {
    if (phase !== "uploading") return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [phase]);

  function uploadBlob(blob: Blob, name: string, mtimeMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("POST", "/api/import/upload");
      xhr.setRequestHeader("X-MyMoment", "1");
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        setProgress((p) => (p ? { ...p, fileBytes: e.loaded } : p));
      };
      xhr.onerror = () => reject(new Error("网络中断，请重试"));
      xhr.onabort = () => reject(new Error("已停止"));
      xhr.onload = () => {
        if (xhr.status === 401) {
          window.dispatchEvent(new Event("session-expired"));
          reject(new Error("登录已过期，请重新登录后再上传"));
          return;
        }
        try {
          const r = JSON.parse(xhr.responseText);
          if (xhr.status < 300) resolve();
          else reject(new Error(r.error || "上传失败"));
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

  async function uploadFiles(files: UploadFile[]) {
    if (!files.length || busyRef.current) return;
    busyRef.current = true;
    stopRef.current = false;
    setError("");
    updateThumbs((ts) => {
      ts.forEach((t) => URL.revokeObjectURL(t.url));
      return [];
    });
    totalBytesRef.current = files.reduce((s, f) => s + f.size, 0);
    const prog: Progress = {
      index: 0,
      total: files.length,
      doneBytes: 0,
      fileBytes: 0,
      currentName: "",
      imported: 0,
      duplicates: 0,
      failures: [],
    };
    setProgress({ ...prog });
    setPhase("uploading");
    const paint = (force = false) => {
      const now = Date.now();
      if (force || now - lastPaintRef.current > 150) {
        lastPaintRef.current = now;
        setProgress({ ...prog, failures: [...prog.failures] });
      }
    };
    for (let i = 0; i < files.length; i++) {
      if (stopRef.current) break;
      const { file } = files[i];
      prog.index = i + 1;
      prog.currentName = file.name;
      prog.fileBytes = 0;
      paint(true);
      try {
        if (file.size > 2 * 1024 ** 3) throw new Error("单个文件不能超过 2 GB");
        await uploadBlob(file, file.name, file.lastModified);
        prog.imported++;
        if (imageExt.has(extOf(file.name)) && file.size < 50 * 1024 ** 2) {
          updateThumbs((ts) => {
            const next = [...ts, { url: URL.createObjectURL(file), name: file.name }];
            if (next.length > 24) URL.revokeObjectURL(next.shift()!.url);
            return next;
          });
        }
      } catch (e) {
        if (stopRef.current) break;
        prog.failures.push({ file, error: e instanceof Error ? e.message : String(e) });
        paint(true);
      }
      prog.doneBytes += file.size;
      paint(true);
    }
    busyRef.current = false;
    paint(true);
    setPhase("done");
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const list = [...(e.target.files || [])].map((file) => ({ file, size: file.size }));
    e.target.value = "";
    if (list.length) void uploadFiles(list);
  }

  function retryFailed() {
    if (!progress?.failures.length) return;
    const list = progress.failures.map(({ file }) => ({ file, size: file.size }));
    void uploadFiles(list);
  }

  const totalBytes = totalBytesRef.current;
  const pct =
    progress && totalBytes
      ? Math.min(100, Math.round(((progress.doneBytes + progress.fileBytes) / totalBytes) * 100))
      : 0;

  return (
    <main className="phone-import-page">
      <header className="phone-import-head">
        <span className="phone-import-logo">
          <Smartphone size={22} />
        </span>
        <div>
          <h1>手机快传</h1>
          <p>选好照片点一下，直接传进家庭相册</p>
        </div>
      </header>

      {!isMobile && links.length > 0 && (
        <section className="phone-card share-card">
          <Wifi size={20} />
          <div style={{ flex: 1 }}>
            <h3>让家人扫码上传</h3>
            <p>家人手机连家里 Wi-Fi 后扫码，即可进入本页传照片（首次需输入相册密码）。</p>
            <div className="share-qr">
              {links.map((url) => (
                <QrLink key={url} url={url} />
              ))}
            </div>
          </div>
        </section>
      )}
      {!isMobile && links.length === 0 && (
        <section className="phone-card">
          <Wifi size={20} />
          <div>
            <h3>家人如何上传</h3>
            <p>
              让家人手机连家里 Wi-Fi，用手机浏览器打开这台电脑的局域网地址（形如
              <code>192.168.x.x:3080</code>）并登录；先这样打开过一次后，刷新本页就会自动出现扫码入口。
            </p>
            <Button variant="outline" size="sm" onClick={() => void loadNetwork()} disabled={networkLoading}>
              <RefreshCcw className={networkLoading ? "spin" : undefined} />
              {networkLoading ? "正在获取地址…" : "重新获取局域网地址"}
            </Button>
          </div>
        </section>
      )}

      <section className="phone-card">
        <span className="phone-card-icon">
          {phase === "uploading" ? <LoaderCircle className="spin" size={20} /> : <CloudUpload size={20} />}
        </span>
        <div style={{ flex: 1 }}>
          <h3>{phase === "uploading" ? "正在上传" : "选择照片和视频"}</h3>
          <p>
            一次可以选很多张。上传完成后照片自动按拍摄时间归档；视频转码需要一点时间，稍后在「整理动态」里能看到进度。
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*,.heic,.heif,.mkv,.avi"
            style={{ display: "none" }}
            onChange={onPick}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={phase === "uploading"}>
            <Images />
            从相册选择
          </Button>
        </div>
      </section>

      {(phase === "uploading" || phase === "done") && progress && (
        <section className={`phone-card ${phase === "done" ? "done" : ""}`}>
          <span className="phone-card-icon">
            {phase === "done" ? <CheckCircle2 size={20} /> : <CloudUpload size={20} />}
          </span>
          <div style={{ flex: 1 }}>
            <h3>{phase === "done" ? "上传完成" : "传输中"}</h3>
            <div className="phone-progress-bar">
              <i style={{ width: `${pct}%` }} />
            </div>
            <div className="phone-progress-meta">
              <span>
                {progress.index} / {progress.total} 个文件 · {pct}%
              </span>
              <span>
                {formatBytes(progress.doneBytes + progress.fileBytes)} / {formatBytes(totalBytes)}
              </span>
            </div>
            {phase === "uploading" && <p className="phone-current">{progress.currentName}</p>}
            <p className="phone-stats">
              已上传 <b>{progress.imported}</b> 个 · 已在相册中 <b>{progress.duplicates}</b> 个
              {progress.failures.length > 0 && (
                <>
                  {" "}· 失败 <b>{progress.failures.length}</b> 个
                </>
              )}
            </p>
            {phase === "done" && progress.failures.length > 0 && (
              <ul className="phone-fails">
                {progress.failures.slice(0, 10).map((f, i) => (
                  <li key={i}>
                    {f.file.name}：{f.error}
                  </li>
                ))}
                {progress.failures.length > 10 && <li>…以及另外 {progress.failures.length - 10} 个</li>}
              </ul>
            )}
            {phase === "done" && progress.failures.length > 0 && (
              <div className="phone-actions">
                <Button onClick={retryFailed}>
                  <RefreshCcw />
                  重试失败的 {progress.failures.length} 个
                </Button>
              </div>
            )}
          </div>
        </section>
      )}

      {phase === "uploading" && thumbs.length > 0 && (
        <section className="phone-card">
          <div style={{ flex: 1 }}>
            <h3>刚上传的照片</h3>
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
    </main>
  );
}

function QrLink({ url }: { url: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 160 }).then(setSrc).catch(() => {});
  }, [url]);
  return (
    <figure className="share-qr-item">
      {src ? <img src={src} alt={url} /> : <LoaderCircle className="spin" />}
      <figcaption>{url.replace("http://", "").replace("/?assistant=upload", "")}</figcaption>
    </figure>
  );
}
