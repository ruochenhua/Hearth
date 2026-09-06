# Hearth architecture

Hearth is intentionally kept as a small monorepo: the Node service owns the
private data lifecycle, while the Vite app is a separately installable frontend
package. The public launchers are thin adapters around the runtime scripts so
the product can keep one startup flow on Windows, macOS, and Linux.

## Directory map

```text
.
├── server/
│   ├── index.mjs             # stable production process entrypoint
│   ├── src/                  # HTTP application and media domain code
│   │   ├── app.mjs
│   │   ├── db.mjs
│   │   ├── importer.mjs
│   │   └── geo/               # offline boundary data and lookup code
│   └── cli/                  # one-shot service maintenance commands
├── web/
│   ├── src/
│   │   ├── app/               # application entry composition
│   │   ├── features/          # user-facing business flows
│   │   ├── components/ui/     # reusable UI primitives
│   │   ├── hooks/             # shared React hooks
│   │   ├── lib/               # browser utilities and integrations
│   │   └── styles/            # global design tokens and styles
│   └── index.html
├── scripts/
│   ├── import/               # external media import adapters
│   ├── maintenance/          # setup, backup, and generated-data tasks
│   ├── platform/             # user-facing OS launchers and host adapters
│   │   ├── windows/           # CMD, PowerShell, VBS and Docker helpers
│   │   ├── macos/             # Finder-friendly .command launchers
│   │   └── linux/             # shell launchers
│   └── runtime/              # cross-platform launcher/control agent
├── tests/                    # Node integration and platform regression tests
├── data/                     # runtime-only media, SQLite, and generated files
├── inbox/                    # runtime-only external import directory
└── backups/                  # runtime-only backup snapshots
```

## Dependency boundaries

- `server/index.mjs` starts and stops the process; application behavior belongs
  in `server/src`.
- `server/src/app.mjs` owns HTTP wiring and authentication. Database schema and
  serialization stay in `db.mjs`; media processing stays in `importer.mjs`.
- `scripts/` may call the service or host tools, but product code must not
  depend on a launcher script.
- `web/src/features` may use shared UI primitives and `web/src/lib`, but UI
  primitives must not import feature code.
- `data`, `inbox`, and `backups` are user state. They are never source files,
  never copied into the image, and never modified by refactors.

## Runtime flow

```text
launcher → local control agent → Docker/Node service
                                      ↓
browser ← authenticated HTTP API ← SQLite + private media files
```

The `web` package builds static assets into `web/dist`; the Node service serves
those assets and exposes the authenticated `/api` endpoints. This keeps local
deployment simple while preserving a clean frontend/backend boundary.

The Docker container cannot enumerate the host's Wi-Fi adapters. The Windows
launcher therefore injects the default-route LAN address through
`ALBUM_LAN_ADDRESSES`; `/api/network` uses it as the stable QR-code source.
