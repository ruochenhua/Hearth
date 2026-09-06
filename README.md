# MyMoment · 家庭影像馆

一个优先支持安卓导入、运行在家中电脑上的私人相册。原片保留在本地磁盘，浏览器中查看照片、播放视频、编辑标签和地点、收藏和评论。页面适配电脑与手机。

## 已实现

| 需求 | 当前实现 |
| --- | --- |
| 手机快传 | 家人手机连家里 Wi-Fi，扫码或输地址直达上传页；批量多选、进度、缩略图、失败重试；安卓和 iPhone 通用，无需数据线 |
| 数据线导入向导 | 网页内通过 USB 直连安卓手机（WebUSB/ADB），选目录扫描、流传输、SHA-256 去重、实时速度与剩余时间；无需安装 adb 或输入命令 |
| 安卓导入 | USB/ADB 增量导入，默认递归扫描 `/sdcard` 中支持的照片和视频；可指定一个或多个目录；支持定时重复检查 |
| 网页导入 | 多选、拖放上传、电脑文件夹选择；逐文件进度和失败重试；单文件最大 2 GB |
| 自动整理 | 优先读取 EXIF/视频拍摄时间，回退文件修改时间；按年月归档；SHA-256 内容去重 |
| 标签和地点 | 读取已有 IPTC/XMP 标签、EXIF GPS、部分视频 GPS；内置全国区县边界做离线逆地理编码，照片自动带「省 · 市 · 区县」；支持手动标签和地点；足迹按省/市/区县层级浏览 |
| 视频 | FFmpeg 生成 H.264/AAC MP4 预览；HTML5 播放器支持拖动进度；原片可下载 |
| 家庭互动 | 共享密码登录、收藏、称呼和评论 |
| 管理 | 导入队列、阶段进度、失败明细与重试、自动扫描设置、磁盘容量、视频工具状态 |
| 长期运行 | Docker Compose、健康检查、自动重启、日志轮转、SQLite 迁移、任务重启恢复、备份脚本 |

这版使用**一个家庭共享密码**。登录的家人均可上传、修改元数据和发表评论，评论称呼由填写者提供。暂未实现独立账号和管理员分权。

没有接入 AI 图像识别、人脸识别或任何联网地图/地理编码服务。地点名称来自内置的离线逆地理编码（全国 2875 个区县边界数据随项目分发，GPS 坐标直接本地查「省 · 市 · 区县」，坐标系自动转换，境外照片回退 EXIF 城市字段或留空）、媒体已有字段或手动填写；所有私人媒体都保存在本地，不会被上传到云相册。

## 快速启动：Docker（推荐长期运行）

电脑需要 Docker Desktop（Linux 容器模式）。初始化脚本需要 Node.js 24.13 或更高的 24.x 版本；也可手动复制 `.env.example` 为 `.env`，设置一个独立的至少 12 位密码。

在本项目目录运行：

```powershell
node scripts/setup.mjs
docker compose up -d --build
```

不同系统都使用同一个浏览器控制中心，不把 WinForms/PowerShell 当成产品界面：Windows 双击 `Start-MyMoment.cmd`，macOS 双击 `Start-MyMoment.command`，Linux 运行 `Start-MyMoment.sh`。三个入口最终都调用同一个 `scripts/launch-control.mjs`，自动启动本机控制代理、启动相册并打开 `http://127.0.0.1:3090`。Windows 启动时会自动创建只允许本地子网访问 TCP 3080 的防火墙规则，首次修复会请求一次管理员权限；Linux 使用系统的 `sudo`/`ufw`/`firewalld` 权限机制，macOS 交给 Docker Desktop 的网络权限处理。不会配置公网端口转发，也不会关闭系统防火墙。需要脚本停止时，三个系统分别运行对应的 `Stop-MyMoment` 文件，它们都调用同一个 `scripts/stop-album.mjs`。

`Start-MyMoment-GUI.vbs` 和旧的 PowerShell 控制中心脚本保留为 Windows 兼容备用方式；日常使用优先双击 `Start-MyMoment.cmd`。后续发布 GitHub Release 时，可以把这个统一入口和 Node 运行时分别封装成 Windows、macOS、Linux 安装包。

初始密码在 `.local-access.txt` 中。初始化脚本不会覆盖已有 `.env`。

- 电脑访问：`http://localhost:3080`
- 手机连接相同 Wi-Fi 后访问：`http://电脑的局域网IP:3080`
- 用 `ipconfig` 找到正在使用的 Wi-Fi / 以太网 IPv4 地址；虚拟机网卡的 IP 通常不适合手机访问。
- Windows 防火墙如需放行，将 TCP 3080 限定在“专用网络”和本地子网；不要在路由器上配置公网端口转发。
- 可在 `.env` 修改 `PORT`，再执行 `docker compose up -d`。

如果 Docker Hub 网络连接超时，可在 `.env` 设置 `NODE_IMAGE=public.ecr.aws/docker/library/node:24-bookworm-slim`，使用 [Docker 官方发布到 Amazon ECR 的镜像](https://www.docker.com/blog/news-from-aws-reinvent-docker-official-images-on-amazon-ecr-public/)。当前电脑已经使用该配置成功构建。

Compose 将 `./data` 挂载到 `/data`，将 `./inbox` 只读挂载到 `/import`。原片和数据库都不放在容易随容器删除而丢失的容器层中。Linux 主机请先创建目录，并确保镜像中的 `node` 用户（UID 1000）可以写数据目录、读取导入目录。

```text
MyMoment/
  data/
    album.sqlite               # 索引、标签、评论、设置、任务和登录会话
    originals/2026/09/...       # 原文件，按归档时区的年月存放，文件名含内容哈希
    thumbnails/...             # 列表缩略图
    previews/...               # 照片 JPEG 和视频 MP4 预览
    uploads/...                # 排队或失败的上传暂存文件
  inbox/                       # 手机桥接、外部同步或手动复制的入口
  backups/                     # 完整备份，包含私人配置
  .env                         # 私人配置和密码
```

健康状态：`docker compose ps`；日志：`docker compose logs -f --tail 100 album`；停止：`docker compose stop`；再次启动：`docker compose up -d`。`restart: unless-stopped` 会在 Docker 服务启动时恢复容器；同时需要在 Docker Desktop 设置中开启登录时启动，并避免电脑自动休眠。

## 安卓导入

### 手机快传（推荐，免数据线，iPhone 同样适用）

家人手机连家里 Wi-Fi，用手机浏览器打开相册地址并登录，在侧栏进入「手机快传」即可批量选择照片和视频上传；也可以由电脑打开「手机快传」页，让家人扫页面上的二维码直达。首次登录后 7 天内免再输密码。建议把地址添加到手机主屏幕。

### 方式一：手机浏览器

连接同一 Wi-Fi，打开相册并登录，在“导入中心”选择照片或视频。手机系统会弹出文件/照片选择器，可批量选择。**网页不能在没有授权的情况下读取手机所有目录，也不能可靠地在安卓后台持续同步。** 文件夹选择能力因安卓浏览器而异；不支持时使用多选或 USB 方式。

上传时保持页面打开。文件传完进入服务器队列后，可以离开页面，整理会继续。网络中断可重试失败文件；重复上传会根据内容去重。

### 方式二：数据线网页向导（免安装 adb、免命令行）

电脑上用 Chrome 或 Edge 打开 `http://localhost:3080`，侧栏进入「导入中心」的安卓导入向导（独立小窗口）：

1. 手机开启开发者选项和 USB 调试（OPPO/ColorOS：设置 → 关于本机 → 版本信息，连点「版本号」；再到 设置 → 其他设置 → 开发者选项 打开 USB 调试），用数据线连接电脑。
2. 向导里点「连接手机」，浏览器设备列表中选择手机；手机弹出「允许 USB 调试」时勾选允许。
3. 选择扫描范围（整机 / 相机 / 截图 / 微信，或手动输入路径），扫描后确认文件数量和总大小，点「开始导入」。
4. 传输过程有实时进度、当前速度、预计剩余时间、已传照片缩略图和失败重试；已存在的文件按内容哈希自动跳过。

已在 OPPO Find X7 Ultra（ColorOS）实测通过。要求桌面版 Chrome/Edge 且页面从 `localhost` 打开（浏览器的 USB 设备 API 只在这类安全上下文中可用）；手机的 USB 接口不能被 adb 等其他程序占用，被占用时按向导提示拔插一次数据线。

### 方式三：USB/ADB 命令行（指定目录 / 默认所有媒体）

1. 安装 [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools)，让 `adb` 在 PATH 中可用；也可在 `.env` 配置 `ADB_PATH` 指向 `adb.exe`。
2. 手机开启开发者选项和 USB 调试，用数据线连接电脑，并在手机上确认允许这台电脑调试。
3. 执行 `adb devices`，确认设备状态为 `device`。
4. 在电脑项目目录运行：

```powershell
# 默认递归扫描共享内部存储 /sdcard 中的照片和视频
npm run android

# 只扫描相机目录
npm run android -- --source /sdcard/DCIM

# 多个指定目录
npm run android -- --source /sdcard/DCIM -- --source /sdcard/Pictures -- --source /sdcard/Movies

# 每分钟检查变化（手机连接且已授权时持续导入）
npm run android -- --watch 60

# 多台手机时指定设备
npm run android -- --serial DEVICE_SERIAL --source /sdcard/DCIM
```

这份脚本只使用 Node 标准库，不需要先 `npm install`。它会保留手机文件修改时间，使用“大小 + 修改时间”检查增量，先写 `.part` 再重命名，避免相册读到传输一半的文件。相册最终仍会做 SHA-256 内容去重。不会删除手机原件。

默认“所有媒体”指 `/sdcard` 下当前 ADB 授权可读的支持格式，不包括云端占位文件、其他应用的私有沙盒、无权限目录或另一个独立挂载的 SD 卡；额外 SD 卡可通过 `--source /storage/卡号/...` 指定。大图库首次检查需要时间。脚本每轮的发现、传输和错误显示在电脑终端；文件落入 `inbox` 后的整理进度显示在网页。

可用 Windows 任务计划程序在登录时启动 `node --env-file=.env scripts/android-import.mjs --watch 60`，工作目录设为本项目目录。ADB 桥接运行在宿主电脑上，不需要向 Linux 容器透传 USB。

也可以使用你已有的安卓同步工具把手机目录同步到 `inbox`；相册每 60 秒扫描一次（管理页面可改为 15–3600 秒）。稳定不足 10 秒、隐藏文件、符号链接和不支持的扩展名会被跳过。首次导入后，`inbox` 仍占用磁盘空间；确认备份和相册原片完整后，是否清理入口目录由你自行决定。

## 媒体和时间说明

- 照片格式：JPEG、PNG、WebP、GIF、TIFF、AVIF、HEIC/HEIF。HEIC/HEIF 的预览取决于本机 Sharp/FFmpeg 解码能力；解码失败时保留原片并提示，建议手机设置 JPEG 以获得最稳定的兼容性。GIF 预览取静态帧，原 GIF 可下载。
- 视频格式：MP4、MOV、M4V、WebM、MKV、3GP、AVI。转码为最高宽度 1920 像素的 H.264/AAC MP4；大视频可能耗时较长，当前串行处理以控制资源占用。
- 浏览器上传单文件最大 2 GB。大于 2 GB 的视频可经 ADB/导入目录进入；转码单任务最大等待 2 小时。
- 原片按内容哈希存储，不修改其字节；原文件名保存在数据库并用于下载。
- 优先读取拍摄时间；没有拍摄时间时回退文件修改时间。网页会明确显示时间来源。无时区的 EXIF 时间按服务时区解释；默认 `TZ=Asia/Shanghai`。归档月份按服务时区固定，已有归档不会因后来修改时区自动重排。
- GPS/标签是否存在取决于拍摄设备、定位权限和分享软件是否移除了元数据。
- 本版本不包含删除原片接口。预览生成失败的媒体仍保留在相册，可以下载原文件。

## 更新、备份和恢复

### 更新

先备份，再替换应用源代码、构建新镜像；保留 `.env`、`data`、`inbox`：

```powershell
npm run backup
docker compose up -d --build
docker compose ps
```

应用启动时根据 SQLite `user_version` 执行迁移，拒绝使用过旧的程序读取更新版数据库。已有 v1 数据库升到 v2 前会额外生成数据库快照。回退程序版本时，应同时恢复升级前的完整备份。

修改 `.env` 的密码后，使用 `docker compose up -d --force-recreate` 让容器读到新环境变量，旧会话会失效。仅执行 `docker compose restart` 不会刷新容器环境变量。

### 完整备份

```powershell
npm run backup
```

脚本暂停正在运行的 Compose `album` 服务，将整个数据目录和 `.env` 复制到 `backups/时间戳`，检查备份数据库完整性，并恢复原本正在运行的服务。成功备份带 `COMPLETE` 标记；没有该标记的目录视为未完成。备份需要额外磁盘空间并会暂时中断相册访问。保存到另一个硬盘的副本才能保护你免受主硬盘损坏影响。

原生 Node 运行模式下，**先停止 Node 服务**，再执行：

```powershell
npm run backup -- --local-stopped
```

`--local-stopped` 是你已停止所有写入进程的声明，不会替你停止原生 Node 服务。备份不复制 `inbox`；还未完成扫描的手机文件仍需要保留在手机或入口目录。失败上传与已入队上传保存在 `data/uploads`，包含在备份中。

### 恢复

1. 停止相册：`docker compose stop`（原生模式则停止 Node）。
2. 保留当前 `data` 作为回退副本，准备一个**空目标目录**，将备份内 `data` 的全部内容复制进去。
3. 恢复备份 `.env`，或保留现有密码并把 `DATA_DIR` 指向刚恢复的目录；根据新电脑调整路径。
4. 用与备份相同或更新的应用版本执行 `docker compose up -d`。
5. 登录检查照片、视频和评论；已暂存的上传会恢复，外部入口中缺失的未完成任务需要重新连接原导入目录再重试。

不要只备份数据库，也不要把备份直接覆盖到仍在运行的数据目录。数据库记录与原片必须一起保存。

## 不使用 Docker：开发和本地运行

需要 Node 24.x、FFmpeg 和 FFprobe 在 PATH 中。可通过 `.env` 的 `FFMPEG_PATH`、`FFPROBE_PATH` 指定可执行文件绝对路径。

```powershell
node scripts/setup.mjs
npm ci
npm --prefix web ci
npm run build
npm start
```

开发前端：另开终端执行 `npm --prefix web run dev`，访问 `http://localhost:5173`；它把 `/api` 转发到 3080。后端改动后重启 `npm start`，或者用 `npm run dev` 自动重启后端。生产模式只需 3080 一个端口。

```powershell
npm test
npm run build
docker compose config --quiet
```

测试使用独立 `test-output` 目录和生成的媒体夹具，不修改你的相册或导入真实照片。覆盖登录权限/跨站写入限制、EXIF、原片完整性、去重、批量哈希查重、标签和评论、目录扫描、视频转码/Range、任务重试、重启恢复、密码轮换、离线逆地理编码和网络地址发现。Windows 启动器测试在未安装 PowerShell 7（pwsh）的环境自动跳过。

也验证了完整离线备份、数据库完整性，以及从备份恢复照片与评论。数据线网页导入向导已在 OPPO Find X7 Ultra 真机验证；尚未做浏览器视觉和交互自动化测试。可选 WebMCP 导入工具已通过特性检测接入；当前没有支持的 WebMCP 验证上下文，未验证其浏览器注册和调用。

## 离线地理编码数据

`server/geo/counties.json`（全国 2875 个区县边界，GCJ-02 坐标，约 16 MB）由 `scripts/build-geo-data.mjs` 从阿里云 DataV 公开边界数据生成并随项目分发；重新生成或更新边界时运行 `node scripts/build-geo-data.mjs`。EXIF GPS（WGS-84）在查询前自动转换到同一坐标系；查询完全在本地进行，不发送任何坐标到外部服务。已有照片可用 `docker compose exec album node server/backfill-location.mjs` 回填缺失的地点（只补空缺，不覆盖手动填写的内容）。

## 技术结构

浏览器 React + TypeScript + Shadcn/Base UI；服务端 Express + Node 内置 SQLite；Sharp / exifr 处理照片与元数据，FFmpeg / FFprobe 处理视频；数据线导入向导基于 @yume-chan/adb（WebUSB/ADB）与 @noble/hashes（增量 SHA-256）；快传二维码使用 qrcode。前端由 Sites 模板初始化，运行方式已适配本地静态前端 + Node 服务，不依赖 Sites 云端部署、云账号或云数据库。

```text
安卓（浏览器上传 / ADB / 外部目录同步）
  → uploads 暂存 / inbox 导入目录
  → SQLite 持久任务队列
  → 私有文件快照 → SHA-256 去重 → 元数据 → 原片归档 + 预览
  → 受登录保护的 HTTP API → 家庭相册网页
```

首次 SQLite 初始化、会话、设置和任务状态都保存在磁盘。进程异常退出后重放尚未完成的任务；重复导入是幂等的。预览中的评论按纯文本渲染；媒体 URL 也需要登录；下载原片使用附件响应。会话 Cookie 为 HttpOnly、SameSite=Strict；登录有频率限制；写操作需同源和自定义请求头校验。

当前默认通过局域网 HTTP 访问。如果以后需要公网访问，应另行配置 HTTPS 和访问控制；`COOKIE_SECURE=true` 只用于真正的 HTTPS 环境。本版本没有自动开放公网、配置路由器或修改防火墙。

官方参考：[ADB](https://developer.android.com/tools/adb)、[Node SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)、[Express 安全实践](https://expressjs.com/en/advanced/best-practice-security/)。
