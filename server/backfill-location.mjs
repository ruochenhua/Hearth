// 为已有媒体回填行政区划位置：有 GPS 坐标但 location 为空的记录重新定位。
// 用法：node server/backfill-location.mjs   （容器内：docker compose exec album node server/backfill-location.mjs）
import { openDatabase } from "./db.mjs";
import { locate } from "./geo.mjs";

const root = process.env.DATA_DIR || "data";
const db = openDatabase(root);
const rows = db
  .prepare(
    "SELECT id,latitude,longitude FROM media WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND location=''",
  )
  .all();
const update = db.prepare("UPDATE media SET location=? WHERE id=?");
let updated = 0;
db.exec("BEGIN");
try {
  for (const row of rows) {
    const location = locate(row.latitude, row.longitude);
    if (location) {
      update.run(location, row.id);
      updated++;
    }
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}
console.log(`共检查 ${rows.length} 条有坐标但无位置的记录，回填 ${updated} 条。`);
db.close();
