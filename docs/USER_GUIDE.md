# 围炉使用手册

这份手册只讲日常使用。更新、备份、恢复和故障排查请看[维护手册](MAINTENANCE.md)。

## 第一次启动

在项目根目录执行一次：

```powershell
node scripts/maintenance/setup.mjs
```

它会创建本地配置、数据目录和导入目录，不会覆盖已有的 `.env`。

之后按系统启动：

| 系统 | 启动入口 | 停止入口 |
| --- | --- | --- |
| Windows | `scripts/platform/windows/start.cmd` | `scripts/platform/windows/stop.cmd` |
| macOS | `scripts/platform/macos/start.command` | `scripts/platform/macos/stop.command` |
| Linux | `scripts/platform/linux/start.sh` | `scripts/platform/linux/stop.sh` |

Windows 用户也可以双击 `scripts/platform/windows/start-gui.vbs` 打开控制中心。第一次启动可能需要 Docker Desktop 和 Windows 防火墙权限。

启动后：

- 电脑打开 `http://localhost:3080`；
- 手机连接同一个 Wi-Fi 后打开电脑显示的局域网地址；
- 初始密码在项目根目录的 `.local-access.txt`，这个文件只保存在本机。

## 密码

围炉当前使用一个家庭共享密码。

- **初始密码**：第一次运行 `node scripts/maintenance/setup.mjs` 时自动生成，保存在项目根目录的 `.local-access.txt`，同时写入 `.env` 的 `ALBUM_PASSWORD`。
- **修改密码**：编辑 `.env` 中的 `ALBUM_PASSWORD`，设置一个至少 12 位的新密码，然后重新创建容器：

  ```powershell
  docker compose up -d --force-recreate
  ```

  如果使用原生 Node 运行，停止旧进程后重新执行 `npm start` 即可。
- **修改后**：旧登录会话会失效，所有家人需要使用新密码重新登录。`.local-access.txt` 不会自动同步新密码，请手动更新或重新查看 `.env`。
- **忘记密码**：先停止服务并备份 `.env`，再直接把 `.env` 的 `ALBUM_PASSWORD` 改成新的至少 12 位密码，按上面的方式重新启动。不要把密码写入 README、截图或聊天记录。

密码只用于本地相册登录；目前没有独立账号和管理员分权。

## 手机快传

这是最适合家人日常使用的方式，Android 和 iPhone 都可以使用。

1. 手机和电脑连接同一个 Wi-Fi。
2. 电脑进入「手机快传」，让家人扫描二维码；也可以直接在手机浏览器打开局域网地址。
3. 输入相册密码，选择照片或视频并上传。
4. 上传完成后可以离开页面，服务器会继续整理；失败的文件可以稍后重试。

手机浏览器不能在没有授权的情况下读取整部手机的所有目录。需要整目录导入时，请使用下面的数据线向导或 ADB。

## 电脑网页导入

在电脑网页进入「导入中心」：

- 可以拖放文件、批量选择文件，或选择文件夹；
- 每个文件显示上传进度；
- 网络中断后可以只重试失败文件；
- 同一份文件重复导入时会自动去重。

## Android 数据线向导

需要桌面版 Chrome 或 Edge，并从 `http://localhost:3080` 打开相册。

1. 在手机设置中打开开发者选项和 USB 调试。
2. 用数据线连接手机，在手机上允许这台电脑调试。
3. 在「导入中心」打开 Android 导入向导，点击「连接手机」。
4. 选择整机、相机、截图、微信或自定义目录，先扫描，再确认文件数量。
5. 点击开始导入，等待传输和整理完成。

浏览器 USB 能力只在合适的安全上下文中可用。如果设备没有出现，拔掉数据线、重新连接，并确认没有其他程序占用 ADB/USB 通道。

## Android ADB 导入

安装 [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools)，确认 `adb devices` 能看到状态为 `device` 的手机，然后在项目根目录执行：

```powershell
# 默认扫描共享内部存储中的照片和视频
npm run android

# 只扫描相机目录
npm run android -- --source /sdcard/DCIM

# 持续检查变化
npm run android -- --watch 60

# 指定设备和目录
npm run android -- --serial DEVICE_SERIAL --source /sdcard/DCIM
```

脚本不会删除手机原件。它会把文件放入 `inbox`，之后由相册队列完成归档、去重和预览生成。

## 浏览相册

- 「相册」按月份浏览照片和视频；
- 「足迹」按省、市、区县查看带有地点的照片；
- 标签、收藏和评论可以帮助家人补充照片上下文；
- 视频会生成浏览器可播放的预览，原片仍可下载；
- 原片按内容哈希保存，导入不会修改原始文件。

## 手机快传没有二维码

请按顺序检查：

1. 电脑和手机是否连接同一个 Wi-Fi；
2. 手机打开的是否是电脑的局域网地址，而不是 `localhost`；
3. Windows 是否允许 Docker/围炉通过专用网络访问；
4. 在电脑控制中心点击「Repair LAN access」后重新打开「手机快传」；
5. 查看手机浏览器是否拦截了局域网页面或缓存了旧页面，重新加载一次。

不要把 3080 端口转发到公网。围炉的默认设计是只在家中局域网使用。
