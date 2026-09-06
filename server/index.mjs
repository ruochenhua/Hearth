import path from "node:path";
import { createApplication } from "./src/app.mjs";

const runtime = await createApplication({
  password: process.env.ALBUM_PASSWORD,
  dataDir: process.env.DATA_DIR || "./data",
  importDir: process.env.IMPORT_DIR || "./inbox",
  secureCookies: process.env.COOKIE_SECURE === "true",
  networkAddresses: (process.env.ALBUM_LAN_ADDRESSES || "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean),
  webDir: path.resolve("web/dist"),
});
const port = Number(process.env.PORT || 3080);
const server = runtime.app.listen(port, process.env.HOST || "0.0.0.0", () =>
  console.log(`Hearth ready: http://localhost:${port}`),
);
server.requestTimeout = 0; // Large video transfers may take longer than Node's default five minutes.
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close();
  await runtime.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
