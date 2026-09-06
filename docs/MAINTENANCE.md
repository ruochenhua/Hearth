# 围炉维护手册

这份手册面向维护项目和数据的人。日常导入和浏览请看[使用手册](USER_GUIDE.md)。

## 维护边界

以下目录是用户数据，不属于源代码：

```text
data/       SQLite、原片、缩略图、预览和上传队列
inbox/      外部导入入口
backups/    完整备份
.env        密码和本机配置
```

重构代码、升级依赖或重新构建镜像时，不要删除、覆盖或提交这些内容。容器重建不会影响它们，因为 `compose.yaml` 把它们挂载到宿主机。

## 常用命令

```powershell
# 查看状态
docker compose ps

# 查看相册日志
docker compose logs -f --tail 100 album

# 停止和启动
docker compose stop album
docker compose up -d

# 完整质量检查
npm run check
npm run check:compose
```

平台入口集中在 `scripts/platform/`：

```text
scripts/platform/
├── windows/   # start.cmd、stop.cmd、PowerShell、控制中心和 Docker 辅助逻辑
├── macos/     # Finder 可双击的 .command 入口
└── linux/     # shell 入口
```

真正跨平台的控制代理在 `scripts/runtime/`，平台脚本只负责适配系统，不要在三个入口里复制业务逻辑。

## 更新应用

更新前先做完整备份：

```powershell
npm run backup
docker compose up -d --build
docker compose ps
```

保留 `.env`、`data/` 和 `inbox/`。应用启动时会根据 SQLite `user_version` 执行迁移；如果需要回退版本，应同时恢复升级前的完整备份。

修改 `.env` 后必须重新创建容器：

```powershell
docker compose up -d --force-recreate
```

单纯执行 `docker compose restart` 不会刷新容器环境变量。

## 密码管理

初始密码由 `node scripts/maintenance/setup.mjs` 随机生成，保存在项目根目录的 `.local-access.txt`，实际配置值在 `.env` 的 `ALBUM_PASSWORD`。两个文件都包含私人密码，不要提交或分享。

修改密码时：

1. 先备份 `.env` 和 `data/`。
2. 编辑 `.env` 的 `ALBUM_PASSWORD`，设置至少 12 位的新密码。
3. Docker 模式执行 `docker compose up -d --force-recreate`。
4. 原生 Node 模式停止旧进程，再重新执行 `npm start`。

应用启动时会检测密码变化、更新本地密码哈希并清除旧会话；家人需要用新密码重新登录。`docker compose restart` 不会读取新的容器环境变量，因此不够用。

如果忘记密码，保留当前 `data/`，只修改 `.env` 后重新创建容器即可，不要删除数据库或重新初始化数据目录。

## 完整备份

```powershell
npm run backup
```

备份脚本会暂停正在运行的 Compose 服务，把 `data/` 和 `.env` 复制到 `backups/<时间戳>/`，检查数据库完整性，再恢复原来的运行状态。成功备份必须带有 `COMPLETE` 标记。

备份需要额外磁盘空间，并会短暂中断相册访问。至少把一份备份复制到另一块硬盘；只放在同一块硬盘上不能防止硬盘损坏。

原生 Node 服务运行时，请先停止服务，再执行：

```powershell
npm run backup -- --local-stopped
```

## 恢复备份

1. 停止相册：`docker compose stop album`。
2. 保留当前 `data/` 作为回退副本。
3. 将备份中的 `data/` 复制到一个空目标目录。
4. 恢复备份中的 `.env`，或按新电脑情况调整现有配置。
5. 用相同或更新的应用版本执行 `docker compose up -d`。
6. 登录检查照片、视频、评论和待处理上传。

不要只恢复数据库，也不要把备份直接覆盖到正在运行的数据目录。数据库记录和媒体原片必须一起恢复。

## 地点数据

离线区县边界文件是 `server/src/geo/counties.json`。需要更新时运行：

```powershell
node scripts/maintenance/build-geo-data.mjs
```

已有照片可以只回填空缺地点，不会覆盖手动填写的内容：

```powershell
docker compose exec album node server/cli/backfill-location.mjs
```

## 手机快传排障

二维码依赖登录后的 `/api/network` 返回有效的局域网 IPv4 地址。排查时检查：

```powershell
docker compose ps
docker compose logs --tail 100 album
```

Windows 启动器会把默认路由对应的地址写入 `ALBUM_LAN_ADDRESSES`，并把 TCP 3080 防火墙规则限制在本地子网。控制中心中的「Repair LAN access」会重新执行这个修复流程。

如果容器健康但二维码仍不可用，确认：

- 手机和电脑在同一个局域网；
- `ALBUM_LAN_ADDRESSES` 不是虚拟网卡地址；
- Windows 防火墙规则允许专用网络的 TCP 3080；
- 手机访问的 URL 使用电脑 LAN IPv4，而不是 `127.0.0.1` 或 `localhost`。

不要配置公网端口转发。若未来需要公网访问，应在 HTTPS 反向代理、访问控制和风险评估完成后再单独设计。

## 发布前检查

提交改动前运行：

```powershell
npm ci
npm ci --prefix web
npm run check
npm run check:compose
git diff --check
```

测试使用隔离的 `test-output/` 和生成的媒体夹具，不会读取真实相册数据。Windows 启动器测试在未安装 `pwsh` 时会自动跳过。
