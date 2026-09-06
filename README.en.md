# Hearth 围炉

> Turn the photos at home into time the whole family can return to.

Hearth is a private family photo album that runs on a computer in your home. Photos and videos come back from phones, computers, or a USB connection, then become a shared place for the family to browse, favorite, comment, and remember together.

<p align="center">
  <img src="web/public/brand/me-hero.png" alt="A family photo album, printed photos, tea, and a plant on a wooden table" width="860">
</p>

## What Hearth is

Hearth is a quiet, local home for family memories. Originals stay on your own computer. There is no cloud album and no third-party photo service in the middle.

<p align="center">
  <img src="docs/images/archive-flow.svg" alt="Photos return home, are organized locally, and become a shared family album" width="900">
</p>

It helps your family:

- upload from a phone browser or a QR code;
- import an Android phone with the browser USB wizard or ADB;
- browse by capture time, place, and tags, and play videos;
- add favorites, comments, and the small context that photos often lose;
- run the album with Docker and protect it with complete backups.

## Start here

Run setup once:

```powershell
node scripts/maintenance/setup.mjs
```

Then use the launcher for your system:

| System | Start | Stop |
| --- | --- | --- |
| Windows | [`scripts/platform/windows/start.cmd`](scripts/platform/windows/start.cmd) | [`scripts/platform/windows/stop.cmd`](scripts/platform/windows/stop.cmd) |
| macOS | [`scripts/platform/macos/start.command`](scripts/platform/macos/start.command) | [`scripts/platform/macos/stop.command`](scripts/platform/macos/stop.command) |
| Linux | [`scripts/platform/linux/start.sh`](scripts/platform/linux/start.sh) | [`scripts/platform/linux/stop.sh`](scripts/platform/linux/stop.sh) |

On Windows, [`start-gui.vbs`](scripts/platform/windows/start-gui.vbs) opens the local control center. Once running:

- open `http://localhost:3080` on the computer;
- connect a phone to the same Wi-Fi and use the LAN address shown by Hearth, or scan the QR code in Quick Share;
- find the initial password in the local `.local-access.txt` file.

<p align="center">
  <img src="docs/images/platform-launchers.svg" alt="Windows, macOS, and Linux launchers share one runtime control center" width="900">
</p>

## Guides

- [使用手册 / User guide](docs/USER_GUIDE.md)
- [维护手册 / Maintenance guide](docs/MAINTENANCE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Contributing](CONTRIBUTING.md)
- [中文 README](README.md)

Hearth currently uses one shared family password and is designed primarily for local Docker use. Its central promise is simple: keep the memories at home, and make them easy for the family to revisit for years.
