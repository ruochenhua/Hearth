import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("source tree keeps stable entrypoints and separated responsibilities", async () => {
  const expected = [
    "server/index.mjs",
    "server/src/app.mjs",
    "server/src/db.mjs",
    "server/src/importer.mjs",
    "server/src/geo.mjs",
    "server/src/geo/counties.json",
    "scripts/import/android-import.mjs",
    "scripts/maintenance/backup.mjs",
    "scripts/runtime/launch-control.mjs",
    "scripts/runtime/stop-album.mjs",
    "web/src/main.tsx",
    "web/src/app/App.tsx",
    "web/src/features/album/AlbumApplication.tsx",
    "web/src/features/about/MeIntroduction.tsx",
    "web/src/features/import/MobileUpload.tsx",
    "web/src/features/import/PhoneImport.tsx",
  ];
  await Promise.all(expected.map((file) => fs.access(path.join(root, file))));
  await fs.access(path.join(root, "web/public/brand/me-hero.png"));

  const removed = [
    "server/app.mjs",
    "server/db.mjs",
    "server/importer.mjs",
    "scripts/android-import.mjs",
    "scripts/backup.mjs",
    "scripts/launch-control.mjs",
    "web/main.tsx",
    "web/app/page.tsx",
  ];
  for (const file of removed)
    await assert.rejects(fs.access(path.join(root, file)), { code: "ENOENT" });

  const launchControl = await fs.readFile(path.join(root, "scripts/runtime/launch-control.mjs"), "utf8");
  const stopAlbum = await fs.readFile(path.join(root, "scripts/runtime/stop-album.mjs"), "utf8");
  assert.match(launchControl, /path\.resolve\([^\n]+, ['"]\.\.['"], ['"]\.\.['"]\)/);
  assert.match(stopAlbum, /path\.resolve\([^\n]+, ['"]\.\.['"], ['"]\.\.['"]\)/);
});
