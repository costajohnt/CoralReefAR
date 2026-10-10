import { BlockList, isIP } from 'node:net';

// Addresses a reverse proxy we run behind can connect from: loopback, RFC 1918,
// link-local, and IPv6 unique-local (Fly's 6PN is fdaa::/16). A peer outside
// these ranges is a direct internet client and its X-Forwarded-For is never
// trusted, whatever the hop count says.
const privateRanges = new BlockList();
privateRanges.addSubnet('127.0.0.0', 8, 'ipv4');
privateRanges.addSubnet('10.0.0.0', 8, 'ipv4');
privateRanges.addSubnet('172.16.0.0', 12, 'ipv4');
privateRanges.addSubnet('192.168.0.0', 16, 'ipv4');
privateRanges.addSubnet('169.254.0.0', 16, 'ipv4');
privateRanges.addAddress('::1', 'ipv6');
privateRanges.addSubnet('fc00::', 7, 'ipv6');
privateRanges.addSubnet('fe80::', 10, 'ipv6');

function isPrivateAddress(addr: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  const plain = mapped ? mapped[1]! : addr;
  const family = isIP(plain);
  if (family === 4) return privateRanges.check(plain, 'ipv4');
  if (family === 6) return privateRanges.check(plain, 'ipv6');
  return false;
}

/**
 * Fastify `trustProxy` value for a deployment behind `hops` reverse proxies.
 *
 * `trustProxy: true` trusts every X-Forwarded-For entry, so `req.ip` becomes
 * the leftmost one, which the client chose. A plain number is no better here:
 * Fastify 5 treats a numeric hop count as "trust nothing" (it cannot validate
 * the peer), which would collapse every visitor onto the proxy's address.
 *
 * Instead, trust the `hops` nearest addresses (index 0 is the socket peer),
 * and only while each one is a private or loopback address. Proxies append the
 * address they saw to the end of the header, so `req.ip` is the address the
 * outermost trusted proxy recorded, and anything the client prepended is ignored.
 */
export function makeTrustProxy(hops: number): false | ((addr: string, i: number) => boolean) {
  if (hops <= 0) return false;
  return (addr: string, i: number) => i < hops && isPrivateAddress(addr);
}
