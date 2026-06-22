import "server-only";

import { lookup } from "node:dns/promises";
import { isIPv4, isIPv6 } from "node:net";

/**
 * SSRF guard for user-supplied URLs (security audit A05.2).
 *
 * The onboarding flow accepts a website URL from an authenticated user and
 * forwards it to Firecrawl for scraping. Even though the outbound HTTP
 * request runs from Firecrawl's edge — not from our server — an
 * authenticated actor can still abuse the action to:
 *   - probe internal endpoints reachable from Firecrawl's network,
 *   - hit cloud-provider metadata services (e.g. AWS / GCP 169.254.169.254),
 *   - burn paid scrape credits on arbitrary URLs.
 *
 * This module centralises the deny-list so the same checks can be reused
 * from the on-blur enrichment action and the on-submit save action. The
 * guard is intentionally strict: anything that can't be proved to be a
 * public, HTTP(S), standard-port endpoint is rejected.
 */

/**
 * Hostnames that are not IP literals but resolve (or have historically
 * resolved) to a loopback / link-local target. We reject these by name in
 * addition to the IP checks below so a forged `/etc/hosts` entry or a
 * resolver quirk can't slip through.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

/**
 * Ports we allow on http / https URLs. Anything else (SSH 22, SMTP 25,
 * Redis 6379, Postgres 5432, etc.) is rejected as defense-in-depth even
 * when the host resolves to a public address — there is no legitimate
 * onboarding URL that uses a non-standard port.
 */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

/**
 * Parse an IPv4 dotted-quad string into a 32-bit unsigned integer in
 * big-endian (network) order. Returns `null` when the input is not a
 * well-formed dotted quad. `node:net#isIPv4` should be used first to gate
 * the input — this helper assumes the caller has already verified the
 * shape and only does the numeric conversion.
 */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (let i = 0; i < 4; i++) {
    const segment = parts[i];
    if (segment === undefined || segment.length === 0) return null;
    // Reject leading zeros (e.g. "010.0.0.1") so we don't have to think about
    // octal interpretation. `isIPv4` is permissive enough to accept them.
    if (segment.length > 1 && segment.startsWith("0")) return null;
    if (!/^\d+$/.test(segment)) return null;
    const value = Number(segment);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    // Shift-or builds the 32-bit value. We use multiplication + addition
    // instead of `<<` because the leftmost shift would interact with JS's
    // signed-32-bit bitwise semantics for octets >= 128.
    result = result * 256 + value;
  }
  return result;
}

/**
 * Check whether an IPv4 address (as integer) falls inside any of the
 * private / loopback / link-local / reserved ranges enumerated in the
 * security audit. Returning `true` means the address is unsafe and must
 * be blocked.
 */
function isUnsafeIPv4Int(addr: number): boolean {
  // 0.0.0.0/8 — "this network", catches the unspecified address and the
  // implicit-local block.
  if ((addr & 0xff_00_00_00) === 0x00_00_00_00) return true;
  // 10.0.0.0/8
  if ((addr & 0xff_00_00_00) === 0x0a_00_00_00) return true;
  // 127.0.0.0/8 — loopback
  if ((addr & 0xff_00_00_00) === 0x7f_00_00_00) return true;
  // 169.254.0.0/16 — link-local (includes cloud metadata 169.254.169.254)
  if ((addr & 0xff_ff_00_00) === 0xa9_fe_00_00) return true;
  // 172.16.0.0/12
  if ((addr & 0xff_f0_00_00) === 0xac_10_00_00) return true;
  // 192.168.0.0/16
  if ((addr & 0xff_ff_00_00) === 0xc0_a8_00_00) return true;
  // 100.64.0.0/10 — Carrier-Grade NAT
  if ((addr & 0xff_c0_00_00) === 0x64_40_00_00) return true;
  // 192.0.0.0/24 — IETF protocol assignments
  if ((addr & 0xff_ff_ff_00) === 0xc0_00_00_00) return true;
  // 192.0.2.0/24 — TEST-NET-1
  if ((addr & 0xff_ff_ff_00) === 0xc0_00_02_00) return true;
  // 198.18.0.0/15 — benchmarking
  if ((addr & 0xff_fe_00_00) === 0xc6_12_00_00) return true;
  // 198.51.100.0/24 — TEST-NET-2
  if ((addr & 0xff_ff_ff_00) === 0xc6_33_64_00) return true;
  // 203.0.113.0/24 — TEST-NET-3
  if ((addr & 0xff_ff_ff_00) === 0xcb_00_71_00) return true;
  // 224.0.0.0/4 — multicast
  if ((addr & 0xf0_00_00_00) === 0xe0_00_00_00) return true;
  // 240.0.0.0/4 — reserved (includes the 255.255.255.255 broadcast)
  if ((addr & 0xf0_00_00_00) === 0xf0_00_00_00) return true;
  return false;
}

/**
 * Wrapper that accepts the IPv4 string form and runs it through both the
 * shape check and the range check.
 */
function isUnsafeIPv4(ip: string): boolean {
  const asInt = ipv4ToInt(ip);
  if (asInt === null) {
    // Couldn't parse — treat as unsafe rather than fall through.
    return true;
  }
  return isUnsafeIPv4Int(asInt);
}

/**
 * Expand an IPv6 address (with at most one `::` shorthand) into the full
 * 8-group form as an array of 16-bit unsigned integers. Returns `null` on
 * malformed input. Also handles the IPv4-mapped form `::ffff:a.b.c.d` by
 * splitting the trailing dotted-quad into two 16-bit groups.
 */
function expandIPv6(ip: string): number[] | null {
  // Strip an optional zone identifier (e.g. "fe80::1%eth0"); we don't need
  // it for range matching.
  const noZone = ip.includes("%") ? ip.slice(0, ip.indexOf("%")) : ip;

  // Split into a head and tail around the optional "::" shorthand.
  const doubleColonCount = noZone.split("::").length - 1;
  if (doubleColonCount > 1) return null;

  let head: string[];
  let tail: string[];
  if (doubleColonCount === 1) {
    const [headRaw, tailRaw] = noZone.split("::");
    head = headRaw === undefined || headRaw === "" ? [] : headRaw.split(":");
    tail = tailRaw === undefined || tailRaw === "" ? [] : tailRaw.split(":");
  } else {
    head = noZone.split(":");
    tail = [];
  }

  // If the final group of the tail (or, when there's no "::", the final
  // group of the head) is a dotted-quad, expand it into two 16-bit groups.
  const dottedSource = tail.length > 0 ? tail : head;
  if (dottedSource.length > 0) {
    const last = dottedSource[dottedSource.length - 1];
    if (last !== undefined && last.includes(".")) {
      if (!isIPv4(last)) return null;
      const asInt = ipv4ToInt(last);
      if (asInt === null) return null;
      const high = (asInt >>> 16) & 0xffff;
      const low = asInt & 0xffff;
      dottedSource.pop();
      dottedSource.push(high.toString(16), low.toString(16));
    }
  }

  const totalGroups = head.length + tail.length;
  if (totalGroups > 8) return null;
  if (doubleColonCount === 0 && totalGroups !== 8) return null;

  const fillCount = 8 - totalGroups;
  const groups: number[] = [];
  for (const part of head) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    groups.push(parseInt(part, 16));
  }
  for (let i = 0; i < fillCount; i++) groups.push(0);
  for (const part of tail) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    groups.push(parseInt(part, 16));
  }
  if (groups.length !== 8) return null;
  return groups;
}

/**
 * Run the IPv6 range checks: unspecified (`::`), loopback (`::1`),
 * unique-local (`fc00::/7`), link-local (`fe80::/10`), and multicast
 * (`ff00::/8`). IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is detected here and
 * re-checked against the IPv4 rules so the embedded address can't bypass
 * the deny-list.
 */
function isUnsafeIPv6(ip: string): boolean {
  const groups = expandIPv6(ip);
  if (groups === null) {
    // Couldn't parse — treat as unsafe.
    return true;
  }

  // IPv4-mapped IPv6: ::ffff:a.b.c.d (first 80 bits zero, next 16 bits 0xffff)
  const isV4Mapped =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff;
  if (isV4Mapped) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    const v4Int = (high * 0x10000 + low) >>> 0;
    return isUnsafeIPv4Int(v4Int);
  }

  // ::  (unspecified)  and  ::1  (loopback)
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0 &&
    groups[6] === 0 &&
    (groups[7] === 0 || groups[7] === 1)
  ) {
    return true;
  }

  const first = groups[0] ?? 0;
  // fc00::/7 — unique-local (high 7 bits are 1111110, i.e. 0xfc or 0xfd)
  if ((first & 0xfe00) === 0xfc00) return true;
  // fe80::/10 — link-local
  if ((first & 0xffc0) === 0xfe80) return true;
  // ff00::/8 — multicast
  if ((first & 0xff00) === 0xff00) return true;
  // ::ffff:0:0/96 already handled above; everything else is treated as
  // public for now.

  return false;
}

/**
 * Strip the surrounding brackets that the WHATWG URL parser keeps on
 * IPv6 hostnames (e.g. `new URL("http://[::1]/").hostname` returns
 * `"[::1]"`). For non-bracketed hostnames this is a no-op.
 */
function unwrapIPv6Hostname(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

/**
 * Decide whether a hostname/IP literal is safe to forward to an outbound
 * fetch. The hostname may be a DNS name (delegated to the caller) or an IP
 * literal of either family — IP literals are checked here so we don't have
 * to round-trip them through DNS first.
 *
 * Returns `true` when the address is unsafe (private / loopback /
 * link-local / multicast / reserved / metadata).
 */
function isUnsafeAddress(host: string): boolean {
  if (isIPv4(host)) return isUnsafeIPv4(host);
  if (isIPv6(host)) return isUnsafeIPv6(host);
  // Not an IP literal — DNS resolution is the caller's responsibility.
  return false;
}

/**
 * Validate that the given URL string points at a publicly-routable
 * http(s) endpoint on a standard port. Returns `false` on any of:
 *
 *   - URL fails to parse, has an empty hostname, or uses a non-http(s)
 *     scheme,
 *   - port is set to anything other than 80 / 443 (or omitted),
 *   - hostname is one of the well-known loopback aliases
 *     (`localhost`, `ip6-localhost`, ...),
 *   - hostname is an IP literal that falls in a private / loopback /
 *     link-local / multicast / reserved range,
 *   - hostname resolves (DNS A/AAAA) to ANY address in the above ranges
 *     — any single bad answer is enough to block, even when other
 *     answers look public,
 *   - DNS lookup throws (NXDOMAIN, timeout, etc.); we fail closed so a
 *     transient resolver failure can't open the deny-list.
 *
 * The check is intentionally one-shot — the caller is responsible for
 * passing the same normalised URL string downstream so a TOCTOU between
 * this validation and the eventual fetch is bounded by Firecrawl's own
 * resolution path. We can't fully close that window without proxying the
 * fetch ourselves; this guard is defense-in-depth against the obvious
 * cases (literal `127.0.0.1`, hostnames that resolve to RFC 1918, etc.).
 */
export async function isPublicHttpUrl(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  if (!ALLOWED_PORTS.has(parsed.port)) {
    return false;
  }

  const rawHostname = parsed.hostname;
  if (!rawHostname) return false;

  const hostname = unwrapIPv6Hostname(rawHostname).toLowerCase();
  if (!hostname) return false;

  if (BLOCKED_HOSTNAMES.has(hostname)) return false;

  // Direct IP-literal short-circuit so we don't round-trip through DNS.
  if (isIPv4(hostname) || isIPv6(hostname)) {
    return !isUnsafeAddress(hostname);
  }

  // DNS resolution: get every A/AAAA answer and reject if any one of them
  // is unsafe. `verbatim: true` preserves the resolver-supplied ordering
  // so we don't depend on the system's IPv4/IPv6 preference. `all: true`
  // is required to see every address — `lookup` defaults to one entry.
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0) return false;
    for (const entry of addresses) {
      if (isUnsafeAddress(entry.address)) return false;
    }
    return true;
  } catch {
    // NXDOMAIN, EAI_AGAIN, timeouts, etc. — fail closed.
    return false;
  }
}
