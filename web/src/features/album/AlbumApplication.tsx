import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Images,
  Heart,
  MapPin,
  Upload,
  Settings2,
  Search,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Play,
  Download,
  MessageCircle,
  FolderOpen,
  Smartphone,
  HardDrive,
  Check,
  RefreshCw,
  LogOut,
  Tag,
  CalendarDays,
  LoaderCircle,
  AlertCircle,
  Film,
  X,
  LockKeyhole,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Sidebar,
  SidebarProvider,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { registerImportTools } from "@/lib/agent-tools";
import { api, errorText } from "@/lib/api";
import Brand from "@/components/Brand";
import ErrorNotice from "@/components/ErrorNotice";
import Login from "@/features/auth/Login";
import PhoneImport from "@/features/import/PhoneImport";
import MobileUpload from "@/features/import/MobileUpload";
import MeIntroduction from "@/features/about/MeIntroduction";

type Media = {
  id: string;
  name: string;
  kind: "photo" | "video";
  taken_at: string;
  date_source: string;
  tags: string[];
  location: string;
  latitude: number | null;
  longitude: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  bytes: number;
  favorite: boolean;
  warning: string;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  originalUrl: string;
};
type Stats = {
  total: number;
  photos: number;
  videos: number;
  favorites: number;
  bytes: number;
  freeBytes: number;
  activeJobs: number;
  warnings: number;
  version: string;
  schemaVersion: number;
  capabilities: { ffmpeg: boolean; ffprobe: boolean };
  importDir: string;
  dataDir: string;
  lastScan: number | null;
  scanError: string | null;
};
type Config = { albumName: string; autoImport: boolean; scanSeconds: number };
type Job = {
  id: string;
  source: string;
  state: string;
  created_at: string;
  total: number;
  done: number;
  imported: number;
  duplicates: number;
  failed: number;
  current_file: string | null;
  error: string | null;
};
type View = "library" | "albums" | "places" | "favorites" | "import" | "about" | "settings";
type Query = {
  kind?: string;
  q?: string;
  month?: string;
  tag?: string;
  place?: string;
  favorite?: string;
};
type FormSubmitEvent = { preventDefault: () => void };
const bytes = (n: number) =>
  n >= 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(1)} GB`
    : n >= 1024 ** 2
      ? `${(n / 1024 ** 2).toFixed(1)} MB`
      : `${Math.round(n / 1024)} KB`;
const date = (s: string) =>
  new Date(s).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
const clock = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const duration = (s: number | null) =>
  s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "视频";
export default function AlbumApplication() {
  const [session, setSession] = useState<{ authenticated: boolean; albumName: string } | null>(
      null,
    ),
    [error, setError] = useState("");
  const refreshSession = useCallback(
    () =>
      api<{ authenticated: boolean; albumName: string }>("/session")
        .then((s) => {
          setSession(s);
          setError("");
        })
        .catch((e) => setError(errorText(e))),
    [],
  );
  useEffect(() => {
    void refreshSession();
    const expired = () => setSession((s) => (s ? { ...s, authenticated: false } : s));
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, [refreshSession]);
  if (!session)
    return (
      <div className="boot">
        <Brand />
        {error ? (
          <>
            <ErrorNotice message={error} />
            <Button onClick={refreshSession}>重新连接</Button>
          </>
        ) : (
          <p>
            <LoaderCircle className="spin" />
            正在连接家庭相册…
          </p>
        )}
      </div>
    );
  if (!session.authenticated) return <Login name={session.albumName} onLogin={refreshSession} />;
  const assistant = new URLSearchParams(window.location.search).get("assistant");
  if (assistant === "phone") return <PhoneImport />;
  if (assistant === "upload") return <MobileUpload />;
  return (
    <SidebarProvider>
      <Workspace onLogout={refreshSession} />
    </SidebarProvider>
  );
}
function Workspace({ onLogout }: { onLogout: () => void }) {
  const [view, setView] = useState<View>("library"),
    [query, setQuery] = useState<Query>({}),
    [stats, setStats] = useState<Stats | null>(null),
    [name, setName] = useState("我们的小日子"),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [uploadBusy, setUploadBusy] = useState(false);
  const { setOpenMobile } = useSidebar();
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  useEffect(
    () =>
      registerImportTools(
        async () => ({ jobs: await api("/jobs"), stats: await api("/stats") }),
        async () => {
          if (uploadBusy) throw new Error("请等待当前上传完成");
          const result = await api("/import/scan", { method: "POST" });
          setView("import");
          setOpenMobile(false);
          refresh();
          return result;
        },
      ),
    [uploadBusy, refresh, setOpenMobile],
  );
  useEffect(() => {
    let live = true;
    const load = () =>
      Promise.all([api<Stats>("/stats"), api<Config>("/settings")])
        .then(([s, c]) => {
          if (live) {
            setStats(s);
            setName(c.albumName);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(errorText(e));
        });
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [revision]);
  function navigate(v: View) {
    if (uploadBusy) return;
    setView(v);
    setQuery(v === "favorites" ? { favorite: "true" } : {});
    setOpenMobile(false);
  }
  const nav = [
    { key: "library", icon: Images, label: "所有回忆", count: stats?.total },
    { key: "albums", icon: CalendarDays, label: "自动相册" },
    { key: "places", icon: MapPin, label: "足迹" },
    { key: "favorites", icon: Heart, label: "心动收藏", count: stats?.favorites },
  ] as const;
  return (
    <>
      <Sidebar className="album-sidebar">
        <SidebarHeader>
          <Brand />
        </SidebarHeader>
        <SidebarContent>
          <div className="nav-label">我的相册</div>
          <nav aria-label="相册导航">
            {nav.map(({ key, icon: Icon, label, ...rest }) => (
              <button
                key={key}
                disabled={uploadBusy}
                className={`nav-item ${view === key ? "active" : ""}`}
                onClick={() => navigate(key)}
              >
                <Icon size={20} />
                {label}
                {"count" in rest && rest.count !== undefined && <span>{rest.count}</span>}
              </button>
            ))}
          </nav>
          <div className="nav-label tools-label">管理</div>
          <nav aria-label="管理导航">
            <button
              disabled={uploadBusy}
              className={`nav-item ${view === "import" ? "active" : ""}`}
              onClick={() => navigate("import")}
            >
              <Upload size={20} />
              导入中心{(stats?.activeJobs || 0) > 0 && <span>{stats?.activeJobs}</span>}
            </button>
            <button
              className="nav-item"
              onClick={() => window.open(`${window.location.origin}/?assistant=upload`, "_blank")}
            >
              <Smartphone size={20} />
              手机快传
            </button>
            <button
              disabled={uploadBusy}
              className={`nav-item ${view === "about" ? "active" : ""}`}
              onClick={() => navigate("about")}
            >
              <Sparkles size={20} />
              认识 Me
            </button>
            <button
              disabled={uploadBusy}
              className={`nav-item ${view === "settings" ? "active" : ""}`}
              onClick={() => navigate("settings")}
            >
              <Settings2 size={20} />
              相册设置
            </button>
          </nav>
        </SidebarContent>
        <SidebarFooter>
          <div className="storage">
            <HardDrive size={19} />
            <div>
              原片 {bytes(stats?.bytes || 0)}
              <small>磁盘可用 {stats ? bytes(stats.freeBytes) : "—"}</small>
            </div>
            <span className="status-dot" />
          </div>
          <button
            disabled={uploadBusy}
            className="logout"
            onClick={async () => {
              try {
                await api("/logout", { method: "POST" });
                onLogout();
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            <LogOut size={17} />
            退出相册
          </button>
        </SidebarFooter>
      </Sidebar>
      <div className="workspace">
        <header className="topbar">
          <div>
            <SidebarTrigger className="mobile-menu" />
            <span>{name}</span>
            <span className="private-badge">
              <LockKeyhole size={12} />
              私人相册
            </span>
          </div>
          <span className="connection">
            <i />
            局域网连接
          </span>
        </header>
        <main className="main-content">
          <ErrorNotice message={error} />
          {view === "about" ? (
            <MeIntroduction
              albumName={name}
              photos={stats?.photos || 0}
              videos={stats?.videos || 0}
              onImport={() => navigate("import")}
            />
          ) : view === "import" ? (
            <ImportCenter stats={stats} onChange={refresh} onBusy={setUploadBusy} />
          ) : view === "settings" ? (
            <SettingsView stats={stats} onChange={refresh} />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    {view === "favorites"
                      ? "CLOSE TO HEART"
                      : view === "places"
                        ? "PLACES WE HAVE BEEN"
                        : view === "albums"
                          ? "LITTLE CHAPTERS"
                          : "THE MOMENTS WE KEEP"}
                  </span>
                  <h1>
                    {view === "favorites"
                      ? "心动收藏"
                      : view === "places"
                        ? "我们的足迹"
                        : view === "albums"
                          ? "日子，自成篇章"
                          : "所有回忆"}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>
                    {view === "library"
                      ? `${stats?.photos || 0} 张照片，${stats?.videos || 0} 段视频。每一份，都是生活。`
                      : view === "favorites"
                        ? "把喜欢的瞬间，再看一遍。"
                        : view === "places"
                          ? "按照片中记录的地点聚合，也可以手动标记。"
                          : "按时间或已有标签，整理每一段故事。"}
                  </p>
                </div>
                <Button size="lg" onClick={() => navigate("import")}>
                  <Upload />
                  导入回忆
                </Button>
              </div>
              {(view === "albums" || view === "places") &&
              !query.month &&
              !query.tag &&
              !query.place ? (
                <Albums
                  places={view === "places"}
                  total={stats?.total || 0}
                  revision={revision}
                  onSelect={(key, value) => setQuery({ [key]: value })}
                  onImport={() => navigate("import")}
                />
              ) : (
                <Gallery
                  query={query}
                  setQuery={setQuery}
                  total={stats?.total || 0}
                  revision={revision}
                  onChange={refresh}
                  onImport={() => navigate("import")}
                  collectionView={view === "albums" || view === "places"}
                />
              )}
            </>
          )}
        </main>
        <footer className="page-footer">
          <span>围炉 Hearth</span>家里的回忆，随时可见。
          <span>LOCAL STORAGE · v{stats?.version || "0.1.0"}</span>
        </footer>
      </div>
    </>
  );
}
function Empty({
  filtered,
  onImport,
  onReset,
}: {
  filtered?: boolean;
  onImport: () => void;
  onReset?: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Images size={36} />
      </div>
      <span className="eyebrow">{filtered ? "A LITTLE TOO QUIET" : "YOUR STORY STARTS HERE"}</span>
      <h2>{filtered ? "还没有符合条件的回忆" : "第一份回忆，从这里开始"}</h2>
      <p>
        {filtered
          ? "试试其他关键词，或换一个筛选条件。"
          : "从手机选择照片与视频，或连接安卓手机导入整个目录。"}
      </p>
      <Button onClick={filtered ? onReset : onImport}>
        {filtered ? "清除筛选" : "导入照片与视频"}
        <ArrowUpRight />
      </Button>
      {!filtered && (
        <div className="empty-notes">
          <span>
            <Check />
            保留原片
          </span>
          <span>
            <Check />
            自动去重
          </span>
          <span>
            <Check />
            按时间归档
          </span>
        </div>
      )}
    </div>
  );
}
type PlaceNode = {
  name: string;
  count: number;
  latest: string;
  full?: string;
  children: Map<string, PlaceNode>;
};
// 把平铺的地点列表（「省 · 市 · 区县」）组织成省 → 市 → 区县的树，并逐级汇总数量
function buildPlaceTree(items: { key: string; count: number; latest: string }[]): PlaceNode[] {
  const root = new Map<string, PlaceNode>();
  for (const { key, count, latest } of items) {
    let node: PlaceNode | undefined;
    for (const part of key.split(" · ")) {
      const level = node ? node.children : root;
      node = level.get(part);
      if (!node) {
        node = { name: part, count: 0, latest: "", children: new Map() };
        level.set(part, node);
      }
      node.count += count;
      if (latest > node.latest) node.latest = latest;
    }
    if (node) node.full = key;
  }
  return [...root.values()].sort((a, b) => b.count - a.count);
}
function Albums({
  places,
  total,
  revision,
  onSelect,
  onImport,
}: {
  places: boolean;
  total: number;
  revision: number;
  onSelect: (key: string, value: string) => void;
  onImport: () => void;
}) {
  const [group, setGroup] = useState(places ? "place" : "month"),
    [items, setItems] = useState<{ key: string; count: number; latest: string }[]>([]),
    [placePath, setPlacePath] = useState<string[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    setGroup(places ? "place" : "month");
    setPlacePath([]);
  }, [places]);
  const placeNodes = useMemo(
    () => (places && group === "place" ? buildPlaceTree(items) : []),
    [places, group, items],
  );
  const placeLevel = useMemo(() => {
    let level = placeNodes;
    for (const name of placePath) {
      const node = level.find((n) => n.name === name);
      level = node ? [...node.children.values()].sort((a, b) => b.count - a.count) : [];
    }
    return level;
  }, [placeNodes, placePath]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    void api<{ items: typeof items }>(`/albums?group=${group}`)
      .then((r) => {
        if (live) {
          setItems(r.items);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [group, total, revision]);
  return (
    <>
      <div className="collection-toolbar">
        {!places && (
          <Tabs value={group} onValueChange={(v) => setGroup(String(v))}>
            <TabsList>
              <TabsTrigger value="month">
                <CalendarDays />
                按月份
              </TabsTrigger>
              <TabsTrigger value="tag">
                <Tag />
                按标签
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <span>
          {items.length} 个{places ? "地点" : "相册"}
        </span>
      </div>
      <ErrorNotice message={error} />
      {loading ? (
        <p className="loading">
          <LoaderCircle className="spin" />
          正在整理目录…
        </p>
      ) : items.length ? (
        places && group === "place" ? (
          <>
            {placePath.length > 0 && (
              <Button
                variant="ghost"
                className="back"
                onClick={() => setPlacePath((p) => p.slice(0, -1))}
              >
                <ArrowLeft />
                返回上级
              </Button>
            )}
            <p className="place-crumb">{["全部足迹", ...placePath].join("　/　")}</p>
            <div className="album-list">
              {placeLevel.map((node, i) => (
                <button
                  key={node.name}
                  className="album-row"
                  onClick={() =>
                    node.full
                      ? onSelect("place", node.full)
                      : setPlacePath([...placePath, node.name])
                  }
                >
                  <span className="album-index">{String(i + 1).padStart(2, "0")}</span>
                  <div className="album-symbol">{node.full ? <MapPin /> : <FolderOpen />}</div>
                  <div>
                    <h2>{node.name}</h2>
                    {node.full && <small>最近的回忆 · {date(node.latest)}</small>}
                  </div>
                  <span>{node.count} 份回忆</span>
                  <ArrowUpRight />
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="album-list">
            {items.map((album, i) => (
              <button
                key={album.key}
                className="album-row"
                onClick={() => onSelect(group, album.key)}
              >
                <span className="album-index">{String(i + 1).padStart(2, "0")}</span>
                <div className="album-symbol">
                  {group === "place" ? <MapPin /> : group === "tag" ? <Tag /> : <CalendarDays />}
                </div>
                <div>
                  <h2>
                    {group === "month"
                      ? `${album.key.slice(0, 4)} 年 ${Number(album.key.slice(5))} 月`
                      : album.key}
                  </h2>
                  <small>最近的回忆 · {date(album.latest)}</small>
                </div>
                <span>{album.count} 份回忆</span>
                <ArrowUpRight />
              </button>
            ))}
          </div>
        )
      ) : total && group === "tag" ? (
        <div className="empty-state">
          <Tag size={35} />
          <h2>给回忆一个关键词</h2>
          <p>打开照片，添加「旅行」「生日」等标签，就会自动形成相册。</p>
        </div>
      ) : (
        <Empty onImport={onImport} />
      )}
    </>
  );
}
function Gallery({
  query,
  setQuery,
  total,
  revision,
  onChange,
  onImport,
  collectionView,
}: {
  query: Query;
  setQuery: (q: Query) => void;
  total: number;
  revision: number;
  onChange: () => void;
  onImport: () => void;
  collectionView: boolean;
}) {
  const [items, setItems] = useState<Media[]>([]),
    [count, setCount] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Media | null>(null),
    [search, setSearch] = useState(query.q || "");
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v)).toString();
  useEffect(() => setSearch(query.q || ""), [query.q]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<{ items: Media[]; total: number }>(`/media?${params}`, { signal: controller.signal })
      .then((r) => {
        setItems(r.items);
        setCount(r.total);
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [params, total, revision]);
  const groups = items.reduce<Record<string, Media[]>>((out, m) => {
    const key = date(m.taken_at);
    (out[key] ||= []).push(m);
    return out;
  }, {});
  async function more() {
    setLoading(true);
    try {
      const r = await api<{ items: Media[]; total: number }>(
        `/media?${params}&offset=${items.length}`,
      );
      setItems((old) => [...old, ...r.items]);
      setCount(r.total);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      {collectionView && (
        <Button variant="ghost" className="back" onClick={() => setQuery({})}>
          <ArrowLeft />
          全部{query.place ? "地点" : "相册"}
          <span>/ {query.month || query.tag || query.place}</span>
        </Button>
      )}
      <div className="gallery-toolbar">
        <Tabs
          value={query.kind || "all"}
          onValueChange={(v) => setQuery({ ...query, kind: v === "all" ? undefined : String(v) })}
        >
          <TabsList variant="line">
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="photo">照片</TabsTrigger>
            <TabsTrigger value="video">视频</TabsTrigger>
          </TabsList>
        </Tabs>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery({ ...query, q: search });
          }}
        >
          <Search size={18} />
          <input
            aria-label="搜索回忆"
            placeholder="搜索文件名、地点、标签"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => {
                setSearch("");
                setQuery({ ...query, q: undefined });
              }}
            >
              <X size={16} />
            </button>
          )}
          <button type="submit">搜索</button>
        </form>
      </div>
      <ErrorNotice message={error} />
      {loading && !items.length ? (
        <p className="loading">
          <LoaderCircle className="spin" />
          正在读取回忆…
        </p>
      ) : !items.length ? (
        <Empty
          filtered={Boolean(Object.values(query).some(Boolean))}
          onReset={() => setQuery({})}
          onImport={onImport}
        />
      ) : (
        <div className="timeline">
          {Object.entries(groups).map(([day, media]) => (
            <section key={day}>
              <div className="day-heading">
                <h2>{day}</h2>
                <span>{media.length} 份回忆</span>
                <i />
              </div>
              <div className="photo-grid">
                {media.map((m) => (
                  <button
                    key={m.id}
                    className="photo-card"
                    onClick={() => setSelected(m)}
                    aria-label={`查看 ${m.name}`}
                  >
                    {m.thumbnailUrl ? (
                      <img src={m.thumbnailUrl} alt={m.name} loading="lazy" />
                    ) : (
                      <div className="unavailable">
                        <Film />
                        <span>
                          原片已保存
                          <br />
                          暂无预览
                        </span>
                      </div>
                    )}
                    <div className="photo-shade" />
                    {m.favorite && (
                      <span className="photo-heart">
                        <Heart size={16} fill="currentColor" />
                      </span>
                    )}
                    {m.kind === "video" && (
                      <span className="video-label">
                        <Play size={12} fill="currentColor" />
                        {duration(m.duration)}
                      </span>
                    )}
                    <div className="photo-caption">
                      <span>{m.location || m.name}</span>
                      {m.tags.length > 0 && <small>{m.tags.slice(0, 2).join(" · ")}</small>}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
          <div className="gallery-end">
            已显示 {items.length} / {count} 份回忆
            {items.length < count && (
              <Button variant="outline" disabled={loading} onClick={more}>
                {loading ? "正在加载…" : "加载更多"}
              </Button>
            )}
          </div>
        </div>
      )}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        {selected && (
          <DialogContent className="media-dialog" showCloseButton={false}>
            <MediaViewer
              key={selected.id}
              media={selected}
              onClose={() => setSelected(null)}
              onChange={onChange}
              onNavigate={(delta) => {
                const i = items.findIndex((m) => m.id === selected.id) + delta;
                if (items[i]) setSelected(items[i]);
              }}
              hasPrev={items.findIndex((m) => m.id === selected.id) > 0}
              hasNext={items.findIndex((m) => m.id === selected.id) < items.length - 1}
            />
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
function MediaViewer({
  media,
  onClose,
  onChange,
  onNavigate,
  hasPrev,
  hasNext,
}: {
  media: Media;
  onClose: () => void;
  onChange: () => void;
  onNavigate: (n: number) => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const [m, setM] = useState(media),
    [tags, setTags] = useState(media.tags.join(", ")),
    [location, setLocation] = useState(media.location),
    [comments, setComments] = useState<
      { id: number; author: string; body: string; created_at: string }[]
    >([]),
    [author, setAuthor] = useState(() => localStorage.getItem("hearth-author") || ""),
    [body, setBody] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const loadComments = useCallback(
    () =>
      api<{ items: typeof comments }>(`/comments/${media.id}`)
        .then((r) => setComments(r.items))
        .catch((e) => setError(errorText(e))),
    [media.id],
  );
  useEffect(() => {
    void loadComments();
  }, [loadComments]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key === "ArrowLeft" && hasPrev) onNavigate(-1);
      if (e.key === "ArrowRight" && hasNext) onNavigate(1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hasPrev, hasNext, onNavigate]);
  async function save(values: object) {
    setBusy(true);
    setError("");
    try {
      setM(await api<Media>(`/media/${m.id}`, { method: "PATCH", body: JSON.stringify(values) }));
      setSaved(true);
      onChange();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function comment(e: FormSubmitEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/comments/${m.id}`, { method: "POST", body: JSON.stringify({ author, body }) });
      localStorage.setItem("hearth-author", author);
      setBody("");
      await loadComments();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="viewer-stage">
        <div className="viewer-tools">
          <span>
            {m.kind === "video" ? "视频" : "照片"} · {date(m.taken_at)}
          </span>
          <Button variant="ghost" size="icon" aria-label="关闭查看器" onClick={onClose}>
            <X />
          </Button>
        </div>
        {m.previewUrl ? (
          m.kind === "video" ? (
            <video
              src={m.previewUrl}
              poster={m.thumbnailUrl || undefined}
              aria-label={m.name}
              controls
              playsInline
              preload="metadata"
              onError={() => setError("此浏览器无法播放预览，请下载原片。")}
            />
          ) : (
            <img src={m.previewUrl} alt={m.name} />
          )
        ) : (
          <div className="viewer-unavailable">
            <Images size={42} />
            <p>这份原片暂时没有预览</p>
            <a href={m.originalUrl}>下载原片</a>
          </div>
        )}
        <div className="viewer-navigation">
          <Button
            aria-label="上一份回忆"
            variant="ghost"
            disabled={!hasPrev}
            onClick={() => onNavigate(-1)}
          >
            <ArrowLeft />
          </Button>
          <span>用 ← → 翻看回忆</span>
          <Button
            aria-label="下一份回忆"
            variant="ghost"
            disabled={!hasNext}
            onClick={() => onNavigate(1)}
          >
            <ArrowRight />
          </Button>
        </div>
      </div>
      <aside className="viewer-details">
        <div className="detail-heading">
          <div>
            <span className="eyebrow">A MOMENT TO KEEP</span>
            <DialogTitle>{m.name}</DialogTitle>
          </div>
          <Button
            aria-label={m.favorite ? "取消收藏" : "收藏"}
            variant="ghost"
            disabled={busy}
            onClick={() => save({ favorite: !m.favorite })}
          >
            <Heart fill={m.favorite ? "currentColor" : "none"} />
          </Button>
        </div>
        <DialogDescription>
          {date(m.taken_at)} · {bytes(m.bytes)}
          {m.width ? ` · ${m.width} × ${m.height}` : ""}
        </DialogDescription>
        <p className="date-source">
          {m.date_source === "metadata" ? "时间来自媒体元数据" : "未找到拍摄时间，使用文件修改时间"}
        </p>
        <ErrorNotice message={error} />
        {m.warning && <div className="notice warning">{m.warning}</div>}
        <form
          className="metadata-form"
          onSubmit={async (e) => {
            e.preventDefault();
            await save({
              tags: tags
                .split(/[,，]/)
                .map((t) => t.trim())
                .filter(Boolean),
              location,
            });
          }}
        >
          <label htmlFor="place">
            <MapPin size={15} />
            地点
          </label>
          <Input
            id="place"
            value={location}
            placeholder="例如：杭州 · 西湖"
            maxLength={120}
            onChange={(e) => {
              setLocation(e.target.value);
              setSaved(false);
            }}
          />
          {m.latitude !== null && m.longitude !== null && (
            <small>
              GPS {m.latitude.toFixed(5)}, {m.longitude.toFixed(5)}
            </small>
          )}
          <label htmlFor="tags">
            <Tag size={15} />
            标签
          </label>
          <Input
            id="tags"
            value={tags}
            placeholder="旅行, 家人, 周末"
            onChange={(e) => {
              setTags(e.target.value);
              setSaved(false);
            }}
          />
          <div className="save-row">
            <small>用逗号分隔，自动归入标签相册</small>
            <Button type="submit" variant="outline" disabled={busy}>
              {saved ? (
                <>
                  <Check />
                  已保存
                </>
              ) : (
                "保存"
              )}
            </Button>
          </div>
        </form>
        <a className="download-link" href={m.originalUrl}>
          <Download size={17} />
          下载原片
          <ArrowUpRight size={15} />
        </a>
        <div className="comments-heading">
          <h3>
            <MessageCircle size={18} />
            留句话吧
          </h3>
          <span>{comments.length}</span>
        </div>
        <div className="comments">
          {comments.length ? (
            comments.map((c) => (
              <article key={c.id}>
                <div>
                  <strong>{c.author}</strong>
                  <time>{clock(c.created_at)}</time>
                </div>
                <p>{c.body}</p>
              </article>
            ))
          ) : (
            <p className="muted">照片之外的故事，也值得留下。</p>
          )}
        </div>
        <form className="comment-form" onSubmit={comment}>
          <Input
            aria-label="你的称呼"
            placeholder="你的称呼"
            maxLength={30}
            required
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          />
          <textarea
            aria-label="评论内容"
            placeholder="还记得这个瞬间吗？"
            maxLength={1000}
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button type="submit" disabled={busy || !body.trim() || !author.trim()}>
            发布评论
            <ArrowUpRight />
          </Button>
        </form>
      </aside>
    </>
  );
}
function ImportCenter({
  stats,
  onChange,
  onBusy,
}: {
  stats: Stats | null;
  onChange: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [uploading, setUploading] = useState(false),
    [progress, setProgress] = useState(0),
    [current, setCurrent] = useState(""),
    [summary, setSummary] = useState(""),
    [failed, setFailed] = useState<{ file: File; error: string }[]>([]),
    [scanning, setScanning] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    folderInput = useRef<HTMLInputElement>(null),
    busyRef = useRef(false);
  const load = useCallback(
    () =>
      api<{ items: Job[]; scanError: string | null }>("/jobs")
        .then((r) => {
          setJobs(r.items);
          if (r.scanError) setError(r.scanError);
        })
        .catch((e) => setError(errorText(e))),
    [],
  );
  useEffect(() => {
    void load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (busyRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  async function uploadFiles(files: File[]) {
    if (!files.length || busyRef.current) return;
    busyRef.current = true;
    setUploading(true);
    onBusy(true);
    setError("");
    setMessage("");
    setSummary("");
    setFailed([]);
    let ok = 0;
    const failures: { file: File; error: string }[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setCurrent(`${i + 1} / ${files.length} · ${file.name}`);
        setProgress(0);
        try {
          if (file.size > 2 * 1024 ** 3) throw new Error("单个文件不能超过 2 GB");
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", "/api/import/upload");
            xhr.setRequestHeader("X-MyMoment", "1");
            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
            };
            xhr.onerror = () => reject(new Error("网络中断，请重试"));
            xhr.onload = () => {
              try {
                const r = JSON.parse(xhr.responseText);
                if (xhr.status === 401) window.dispatchEvent(new Event("session-expired"));
                if (xhr.status < 300) resolve();
                else reject(new Error(r.error || "上传失败"));
              } catch {
                reject(new Error("服务器返回异常"));
              }
            };
            const form = new FormData();
            form.append("file", file);
            form.append("lastModified", String(file.lastModified));
            xhr.send(form);
          });
          ok++;
        } catch (e) {
          failures.push({ file, error: errorText(e) });
        }
      }
    } finally {
      busyRef.current = false;
      setUploading(false);
      onBusy(false);
      setCurrent("");
      setSummary(
        `${ok} 个文件已上传并加入整理队列${failures.length ? `，${failures.length} 个上传失败` : ""}。`,
      );
      setFailed(failures);
      void load();
      onChange();
    }
  }
  async function scan() {
    setScanning(true);
    setError("");
    try {
      const r = await api<{ message: string }>("/import/scan", { method: "POST" });
      setMessage(r.message);
      void load();
      onChange();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setScanning(false);
    }
  }
  const states: Record<string, string> = {
    queued: "等待整理",
    running: "正在整理",
    completed: "已完成",
    partial: "部分失败",
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">BRING YOUR MOMENTS HOME</span>
          <h1>
            让回忆，回家<span className="heading-dot">.</span>
          </h1>
          <p>导入原片，剩下的交给相册慢慢整理。</p>
        </div>
        <span className="section-number">01 — IMPORT</span>
      </div>
      <ErrorNotice message={error} />
      {message && (
        <output className="notice">{message}</output>
      )}
      <div className="import-grid">
        <section
          className="dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void uploadFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <span className="upload-icon">
            <Upload size={32} />
          </span>
          <h2>把照片和视频放进来</h2>
          <p>拖到这里，或从手机、电脑中选择</p>
          <div className="upload-actions">
            <Button disabled={uploading} onClick={() => fileInput.current?.click()}>
              <Images />
              选择照片与视频
            </Button>
            <Button
              variant="outline"
              disabled={uploading}
              onClick={() => folderInput.current?.click()}
            >
              <FolderOpen />
              选择文件夹
            </Button>
          </div>
          <input
            hidden
            ref={fileInput}
            type="file"
            multiple
            accept="image/*,video/*,.heic,.heif,.mkv,.avi"
            onChange={(e) => {
              void uploadFiles(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <input
            hidden
            ref={folderInput}
            type="file"
            multiple
            {...({ webkitdirectory: "" } as object)}
            onChange={(e) => {
              void uploadFiles(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <small>单个文件最大 2 GB · 支持 JPG、PNG、HEIC、MP4、MOV 等</small>
          {uploading && (
            <div className="upload-progress">
              <span>{current}</span>
              <progress max={100} value={progress} />
              <small>
                {progress}% {progress === 100 ? "· 正在加入整理队列" : "· 上传期间请保持此页面打开"}
              </small>
            </div>
          )}
          {summary && (
            <output className="notice">
              <Check size={17} />
              {summary}
            </output>
          )}
          {failed.length > 0 && (
            <div className="upload-failures">
              {failed.map((f, i) => (
                <p key={i}>
                  {f.file.name}：{f.error}
                </p>
              ))}
              <Button variant="outline" onClick={() => uploadFiles(failed.map((f) => f.file))}>
                重试上传失败的文件
              </Button>
            </div>
          )}
        </section>
        <section className="folder-card">
          <FolderOpen size={25} />
          <h2>电脑文件夹自动导入</h2>
          <p>把手机照片同步或复制到下面的目录。新文件会自动进入整理队列。</p>
          <code>{stats?.importDir || "正在读取…"}</code>
          <Button variant="outline" disabled={scanning} onClick={scan}>
            <RefreshCw className={scanning ? "spin" : ""} />
            立即扫描
          </Button>
          <small>不会删除手机或导入目录中的原文件。</small>
        </section>
      </div>
      <section className="android-guide">
        <div className="android-icon">
          <Smartphone size={30} />
        </div>
        <div>
          <h3>手机整机导入（安卓）</h3>
          <p>
            用数据线把手机插到这台电脑，打开导入向导，跟随页面指引开启 USB
            调试并连接，即可把整个手机的照片和视频收进相册，已导入过的会自动跳过。
          </p>
          <Button
            onClick={() =>
              window.open(
                `${window.location.origin}/?assistant=phone`,
                "hearth-phone-import",
                "popup,width=560,height=780",
              )
            }
          >
            <Smartphone />
            打开手机导入向导
          </Button>
          <small>
            向导需要用这台电脑上的 Chrome 或 Edge 打开本机地址（localhost）；手机需插在运行相册服务的电脑上。高级用法仍可用
            <code>npm run android -- --source /sdcard/DCIM</code>。
          </small>
        </div>
      </section>
      <div className="section-heading">
        <h2>
          整理动态 <span>{jobs.length}</span>
        </h2>
        <Button variant="ghost" onClick={load}>
          <RefreshCw />
          刷新
        </Button>
      </div>
      <div className="process-flow">
        <span>
          <Upload />
          导入原文件
        </span>
        <ArrowRight />
        <span>
          <Check />
          校验与去重
        </span>
        <ArrowRight />
        <span>
          <CalendarDays />
          读取时间与地点
        </span>
        <ArrowRight />
        <span>
          <Images />
          生成照片 / 视频预览
        </span>
      </div>
      {jobs.length ? (
        <div className="job-list">
          {jobs.map((job) => (
            <article key={job.id} className="job">
              <div className="job-top">
                <span className={`job-icon ${job.state}`}>
                  {job.state === "running" ? (
                    <LoaderCircle className="spin" />
                  ) : job.state === "partial" ? (
                    <AlertCircle />
                  ) : (
                    <FolderOpen />
                  )}
                </span>
                <div>
                  <h3>
                    {job.source === "upload" ? "浏览器上传" : "文件夹导入"}
                    <small>{clock(job.created_at)}</small>
                  </h3>
                  <p>
                    {job.current_file ||
                      `${job.imported} 个新增 · ${job.duplicates} 个重复 · ${job.failed} 个失败`}
                  </p>
                </div>
                <span className={`job-state ${job.state}`}>{states[job.state] || job.state}</span>
              </div>
              <div className="job-progress">
                <progress max={Math.max(job.total, 1)} value={job.done} />
                <span>
                  {job.done} / {job.total}
                </span>
              </div>
              {job.error && <p className="job-error">{job.error}</p>}
              {job.failed > 0 && (
                <div className="job-retry">
                  <Button
                    variant="outline"
                    disabled={job.state === "running"}
                    onClick={async () => {
                      try {
                        await api(`/jobs/${job.id}/retry`, { method: "POST" });
                        void load();
                      } catch (e) {
                        setError(errorText(e));
                      }
                    }}
                  >
                    重试失败项
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      try {
                        const r = await api<{ items: { name: string; error: string }[] }>(
                          `/jobs/${job.id}/errors`,
                        );
                        setError(r.items.map((t) => `${t.name}：${t.error}`).join("；"));
                      } catch (e) {
                        setError(errorText(e));
                      }
                    }}
                  >
                    查看失败明细
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="quiet-empty">还没有导入记录。第一份回忆正在等你。</div>
      )}
    </>
  );
}
function SettingsView({ stats, onChange }: { stats: Stats | null; onChange: () => void }) {
  const [config, setConfig] = useState<Config | null>(null),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<Config>("/settings")
      .then(setConfig)
      .catch((e) => setError(errorText(e)));
  }, []);
  async function save(e: FormSubmitEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/settings", { method: "PATCH", body: JSON.stringify(config) });
      setSaved(true);
      onChange();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A HOME FOR YOUR MEMORIES</span>
          <h1>
            相册设置<span className="heading-dot">.</span>
          </h1>
          <p>让回忆有序存放，让相册长久陪伴。</p>
        </div>
      </div>
      <ErrorNotice message={error} />
      <div className="stats-grid">
        {[
          { label: "原片总量", value: bytes(stats?.bytes || 0), icon: HardDrive },
          { label: "磁盘可用", value: stats ? bytes(stats.freeBytes) : "—", icon: FolderOpen },
          { label: "正在排队", value: `${stats?.activeJobs || 0} 个任务`, icon: RefreshCw },
          { label: "预览异常", value: `${stats?.warnings || 0} 份`, icon: Images },
        ].map(({ label, value, icon: Icon }) => (
          <div className="stat-card" key={label}>
            <Icon size={20} />
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="settings-grid">
        <section className="settings-card">
          <h2>基本设置</h2>
          {config && (
            <form onSubmit={save}>
              <label htmlFor="album-name">相册名称</label>
              <Input
                id="album-name"
                maxLength={40}
                required
                value={config.albumName}
                onChange={(e) => {
                  setConfig({ ...config, albumName: e.target.value });
                  setSaved(false);
                }}
              />
              <div className="switch-row">
                <div>
                  <label htmlFor="auto-import">自动扫描导入目录</label>
                  <p>检测新文件并自动整理到相册</p>
                </div>
                <Switch
                  id="auto-import"
                  checked={config.autoImport}
                  onCheckedChange={(v) => {
                    setConfig({ ...config, autoImport: v });
                    setSaved(false);
                  }}
                />
              </div>
              <label htmlFor="scan-seconds">扫描间隔（秒）</label>
              <Input
                id="scan-seconds"
                type="number"
                min={15}
                max={3600}
                step={1}
                required
                value={config.scanSeconds}
                onChange={(e) => {
                  setConfig({ ...config, scanSeconds: Number(e.target.value) });
                  setSaved(false);
                }}
              />
              <Button type="submit" disabled={busy}>
                {saved ? (
                  <>
                    <Check />
                    已保存
                  </>
                ) : (
                  "保存设置"
                )}
              </Button>
            </form>
          )}
        </section>
        <section className="settings-card">
          <h2>运行状态</h2>
          <dl>
            <div>
              <dt>服务版本</dt>
              <dd>v{stats?.version || "—"}</dd>
            </div>
            <div>
              <dt>数据库版本</dt>
              <dd>{stats?.schemaVersion || "—"}</dd>
            </div>
            <div>
              <dt>视频处理</dt>
              <dd
                className={
                  stats?.capabilities.ffmpeg && stats?.capabilities.ffprobe
                    ? "healthy"
                    : "unhealthy"
                }
              >
                {stats?.capabilities.ffmpeg && stats?.capabilities.ffprobe
                  ? "已就绪"
                  : "需要安装 FFmpeg / FFprobe"}
              </dd>
            </div>
            <div>
              <dt>最近扫描</dt>
              <dd>
                {stats?.lastScan ? clock(new Date(stats.lastScan).toISOString()) : "尚未扫描"}
              </dd>
            </div>
            <div>
              <dt>数据目录</dt>
              <dd>
                <code>{stats?.dataDir}</code>
              </dd>
            </div>
          </dl>
          {stats?.scanError && <ErrorNotice message={stats.scanError} />}
          <div className="notice">
            原片、缩略图、视频预览、评论都保存在本机数据目录。磁盘可用空间包含预览占用；“原片总量”仅统计原文件。
          </div>
        </section>
        <section className="settings-card maintenance">
          <h2>备份与更新</h2>
          <div>
            <div>
              <h3>备份回忆</h3>
              <p>
                在电脑运行 <code>npm run backup</code>。脚本会停止当前 Docker
                相册，备份整个数据目录，再恢复服务。
              </p>
            </div>
            <div>
              <h3>更新版本</h3>
              <p>
                先完成备份，再运行 <code>docker compose up -d --build</code>
                。数据保存在挂载目录中，更新镜像会继续使用原相册。
              </p>
            </div>
            <div>
              <h3>修改密码</h3>
              <p>
                在电脑的 <code>.env</code> 中修改 ALBUM_PASSWORD（至少 12
                位），然后重建容器或重启本地服务。
              </p>
            </div>
          </div>
          <p className="muted">
            操作步骤与恢复说明见项目 README。家庭成员共用相册密码，均可上传、编辑和评论。
          </p>
        </section>
      </div>
    </>
  );
}
