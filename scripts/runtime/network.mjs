const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const VIRTUAL_INTERFACE_PATTERN = /docker|podman|vmware|vmnet|virtual|vbox|hyper[- ]?v|wsl|bridge|veth|tailscale|zerotier|loopback/i;
const PREFERRED_INTERFACE_PATTERN = /wi-?fi|wlan|ethernet|^en\d*$|^eth\d*$|^wlp\d*$/i;

export const isIpv4 = (value) => {
  if (typeof value !== "string" || !IPV4_PATTERN.test(value)) return false;
  return value.split(".").every((octet) => Number(octet) <= 255);
};

export function localIpv4Addresses(interfaces) {
  const addresses = Object.entries(interfaces || {}).flatMap(([name, entries]) =>
    (entries || [])
      .filter((entry) => entry && entry.family === "IPv4" && !entry.internal && isIpv4(entry.address))
      .map((entry) => ({ address: entry.address, name })),
  );
  const usable = addresses.filter(({ name }) => !VIRTUAL_INTERFACE_PATTERN.test(name));
  const candidates = usable.length ? usable : addresses;
  return [...new Map(
    candidates
      .sort((a, b) => {
        const aScore = PREFERRED_INTERFACE_PATTERN.test(a.name) ? 0 : 1;
        const bScore = PREFERRED_INTERFACE_PATTERN.test(b.name) ? 0 : 1;
        return aScore - bScore || a.address.localeCompare(b.address);
      })
      .map(({ address }) => [address, address]),
  ).values()];
}
