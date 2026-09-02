import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

type InterfaceMap = Record<string, NetworkInterfaceInfo[] | undefined>;

function isPrivateIpv4(address: string) {
  const [first, second] = address.split(".").map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
}

export function getAllowedDevOrigins(
  interfaces: InterfaceMap = networkInterfaces(),
  configuredOrigins = process.env.ALLOWED_DEV_ORIGINS || ""
) {
  const privateLanAddresses = Object.values(interfaces)
    .flatMap((addresses) => addresses || [])
    .filter((address) => address.family === "IPv4" && !address.internal && isPrivateIpv4(address.address))
    .map((address) => address.address);
  const configured = configuredOrigins.split(",").map((origin) => origin.trim()).filter(Boolean);
  return [...new Set(["127.0.0.1", ...privateLanAddresses, ...configured])];
}
