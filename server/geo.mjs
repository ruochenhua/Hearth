// 离线反向地理编码：WGS-84（照片 EXIF GPS）→ GCJ-02（DataV 边界数据）→ 省/市/区县。
import fs from "node:fs";

let counties = null;
function ensureLoaded() {
  if (counties === null)
    try {
      counties = JSON.parse(
        fs.readFileSync(new URL("./geo/counties.json", import.meta.url), "utf8"),
      );
    } catch {
      counties = [];
    }
  return counties.length > 0;
}

const PI = Math.PI;
const AXIS = 6378245.0;
const ECCENTRICITY = 0.00669342162296594323;
const outOfChina = (lng, lat) =>
  lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;

function transformLat(x, y) {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
  return ret;
}
function transformLng(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
  return ret;
}
export function wgsToGcj(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105, lat - 35);
  let dLng = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - ECCENTRICITY * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((AXIS * (1 - ECCENTRICITY)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180) / ((AXIS / sqrtMagic) * Math.cos(radLat) * PI);
  return [lng + dLng, lat + dLat];
}

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const polygonContains = (rings, x, y) =>
  rings.length > 0 && ringContains(rings[0], x, y) && !rings.slice(1).some((r) => ringContains(r, x, y));

export function locate(latitude, longitude) {
  if (!ensureLoaded()) return "";
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  )
    return "";
  const [lng, lat] = wgsToGcj(longitude, latitude);
  for (const c of counties) {
    const [minX, minY, maxX, maxY] = c.box;
    if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
    if (c.geo.some((poly) => polygonContains(poly, lng, lat))) {
      const parts = [c.p, c.c, c.d].filter((v, i, a) => i === 0 || v !== a[i - 1]);
      return parts.join(" · ");
    }
  }
  return "";
}
