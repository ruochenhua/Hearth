import test from "node:test";
import assert from "node:assert/strict";
import { assertValidSource, runAndroidImport } from "../scripts/android-import.mjs";

test("assertValidSource 校验手机目录", () => {
  assert.throws(() => assertValidSource("relative/path"), /绝对路径/);
  assert.throws(() => assertValidSource("/sdcard/evil\npath"), /控制字符/);
  assertValidSource("/sdcard/DCIM");
});

test("runAndroidImport 在 adb 缺失时报友好错误", async () => {
  await assert.rejects(
    runAndroidImport({ adbPath: "hearth-definitely-missing-adb" }),
    /找不到 adb/,
  );
});
