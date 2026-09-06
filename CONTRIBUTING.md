# Contributing to Hearth

## Before submitting a change

Run the complete local quality gate from the repository root:

```powershell
npm ci
npm ci --prefix web
npm run check
```

`npm run check` runs the backend integration suite, the production frontend
build, and the frontend lint gate. To validate the Compose file as well, run:

```powershell
npm run check:compose
```

The Compose check needs `ALBUM_PASSWORD` in the environment or an existing
`.env`; it does not start containers.

## Change boundaries

- Keep user data out of commits. `data/`, `inbox/`, `backups/`, `.env`, and
  generated build output are intentionally ignored.
- Keep public launchers stable. If a script moves, update the launcher,
  documentation, and its regression test in the same change.
- New backend behavior should have an API-level or domain-level Node test.
- New browser behavior should keep loading, empty, error, and retry states
  explicit where the flow can fail.
- Avoid adding a new dependency for a utility already provided by Node, the
  existing UI catalog, or the current build toolchain.

## Useful commands

```powershell
npm test
npm run build
npm --prefix web run typecheck
npm --prefix web run lint
```

Use `npm run backup` before testing migrations or other operations against a
real library. Tests use `test-output/` and should not read from the real
`data/` directory.
