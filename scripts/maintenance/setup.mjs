import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";

const password = randomBytes(18).toString("base64url");
try {
  await fs.writeFile(
    ".env",
    `ALBUM_PASSWORD=${password}\nPORT=3080\nHOST=0.0.0.0\nDATA_DIR=./data\nIMPORT_DIR=./inbox\nTZ=Asia/Shanghai\nCOOKIE_SECURE=false\n`,
    { flag: "wx", mode: 0o600 },
  );
  await fs.writeFile(
    ".local-access.txt",
    `围炉（Hearth）本地访问\n\n地址：http://localhost:3080\n相册密码：${password}\n\n同一局域网可使用 http://电脑局域网IP:3080\n此文件及 .env 包含私人密码，请勿分享或提交到版本库。\n`,
    { flag: "wx", mode: 0o600 },
  );
  await fs.mkdir("inbox", { recursive: true });
  console.log("已生成 .env。初始密码保存在 .local-access.txt。");
} catch (e) {
  if (e.code === "EEXIST") console.log("配置文件已存在，未覆盖。");
  else throw e;
}
