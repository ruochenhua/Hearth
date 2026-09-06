import { test } from "node:test";
import assert from "node:assert/strict";
import { isIpv4, localIpv4Addresses } from "../scripts/runtime/network.mjs";

test("network address discovery validates IPv4 values and prefers physical adapters", () => {
  assert.equal(isIpv4("192.168.31.9"), true);
  assert.equal(isIpv4("192.168.31.999"), false);
  assert.equal(isIpv4("192.168.31"), false);
  assert.deepEqual(
    localIpv4Addresses({
      "VMware Network Adapter VMnet8": [
        { address: "192.168.121.1", family: "IPv4", internal: false },
      ],
      WLAN: [
        { address: "192.168.31.9", family: "IPv4", internal: false },
      ],
      "vEthernet (WSL)": [
        { address: "172.23.160.1", family: "IPv4", internal: false },
      ],
    }),
    ["192.168.31.9"],
  );
});

test("network address discovery falls back when every adapter is virtual", () => {
  assert.deepEqual(
    localIpv4Addresses({
      docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
      "VMware Network Adapter VMnet1": [
        { address: "192.168.159.1", family: "IPv4", internal: false },
      ],
    }),
    ["172.17.0.1", "192.168.159.1"],
  );
});
