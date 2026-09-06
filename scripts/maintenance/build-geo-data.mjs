// 一次性生成 server/src/geo/counties.json：从阿里云 DataV 拉取全国省/市/区县边界（GCJ-02 坐标）并压缩。
// 重新生成：node scripts/maintenance/build-geo-data.mjs
import fs from "node:fs";
import path from "node:path";

const BASE = "https://geo.datav.aliyun.com/areas_v3/bound/";
const OUT = path.resolve("server/src/geo/counties.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(adcode) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${BASE}${adcode}_full.json`);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(600 * (attempt + 1));
  }
  return null;
}
const round = (n) => Math.round(n * 1000) / 1000;
const compact = (coords) =>
  typeof coords[0] === "number" ? [round(coords[0]), round(coords[1])] : coords.map(compact);
function toMulti(geometry) {
  if (!geometry) return [];
  return compact(
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates,
  );
}
function bboxOf(multi) {
  let minX = 180,
    minY = 90,
    maxX = -180,
    maxY = -90;
  const visit = (c) => {
    if (typeof c[0] === "number") {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
    } else c.forEach(visit);
  };
  multi.forEach(visit);
  return [round(minX), round(minY), round(maxX), round(maxY)];
}

const national = await get(100000);
if (!national) throw new Error("无法下载省级边界");
const provinces = national.features.filter((f) => f.properties.level === "province");
const counties = [];
let done = 0;

for (const prov of provinces) {
  const pp = prov.properties;
  const sub = await get(pp.adcode);
  const children = (sub?.features || []).filter((f) => f.properties.adcode !== pp.adcode);
  const districts = children.filter((f) => f.properties.level === "district");
  const cities = children.filter((f) => f.properties.level === "city");
  if (districts.length) {
    // 直辖市/港澳：直接到区县级
    for (const d of districts) {
      const geo = toMulti(d.geometry);
      counties.push({ p: pp.name, c: pp.name, d: d.properties.name, box: bboxOf(geo), geo });
    }
  } else if (cities.length) {
    for (const city of cities) {
      const cp = city.properties;
      const sub2 = cp.childrenNum > 0 ? await get(cp.adcode) : null;
      const ds = (sub2?.features || []).filter(
        (f) => f.properties.level === "district" && f.properties.adcode !== cp.adcode,
      );
      if (ds.length) {
        for (const d of ds) {
          const geo = toMulti(d.geometry);
          counties.push({ p: pp.name, c: cp.name, d: d.properties.name, box: bboxOf(geo), geo });
        }
      } else {
        // 直筒子市（东莞/中山/嘉峪关等）：市级本身就是最细粒度
        const geo = toMulti(city.geometry);
        counties.push({ p: pp.name, c: cp.name, d: cp.name, box: bboxOf(geo), geo });
      }
    }
  } else {
    // 没有下级数据（台湾等）：用省级多边形兜底
    const geo = toMulti(prov.geometry);
    counties.push({ p: pp.name, c: pp.name, d: pp.name, box: bboxOf(geo), geo });
  }
  done++;
  console.log(`${done}/${provinces.length} ${pp.name}，累计 ${counties.length} 个区县`);
  await sleep(120);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(counties));
console.log(`完成：${counties.length} 个区县 → ${OUT}（${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB）`);
