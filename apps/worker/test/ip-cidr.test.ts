import { describe, expect, it } from "vitest";
import { cidrContains, isIsoCountryCode, parseCidr, parseIp, unmapIpv4 } from "@maillink/shared";

describe("IP / CIDR 解析", () => {
  it.each(["0.0.0.0", "192.0.2.1", "255.255.255.255", "::", "::1", "2001:db8::", "2001:DB8:0:0:0:0:0:1", "1:2:3:4:5:6:7:8", "::ffff:192.0.2.1", "64:ff9b::192.0.2.33"])(
    "合法：%s",
    (text) => expect(parseIp(text)).not.toBeNull(),
  );

  it.each(["", "1.2.3", "1.2.3.4.5", "01.2.3.4", "256.1.1.1", "1.2.3.-1", ":::", "1::2::3", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7::8:9", "12345::", "fe80::1%eth0", ":1", "1:", "1:2:3:4:5:6:7:1.2.3.4"])(
    "非法：%s",
    (text) => expect(parseIp(text)).toBeNull(),
  );

  it("CIDR 前缀范围与匹配", () => {
    expect(parseCidr("10.0.0.0/33")).toBeNull();
    expect(parseCidr("10.0.0.0/08")).toBeNull();
    expect(parseCidr("::/129")).toBeNull();
    const v4 = parseCidr("10.1.0.0/15");
    const v6 = parseCidr("2001:db8::/33");
    if (!v4 || !v6) throw new Error("应能解析");
    const ip = (text: string) => unmapIpv4(parseIp(text) ?? { version: 4, bytes: new Uint8Array(4) });
    expect(cidrContains(v4, ip("10.0.255.1"))).toBe(true);
    expect(cidrContains(v4, ip("10.1.255.1"))).toBe(true);
    expect(cidrContains(v4, ip("10.2.0.1"))).toBe(false);
    expect(cidrContains(v4, ip("::ffff:10.0.0.1"))).toBe(true);
    expect(cidrContains(v6, ip("2001:db8:7fff::1"))).toBe(true);
    expect(cidrContains(v6, ip("2001:db8:8000::1"))).toBe(false);
    expect(cidrContains(v6, ip("10.0.0.1"))).toBe(false);
    const all = parseCidr("0.0.0.0/0");
    if (!all) throw new Error("应能解析");
    expect(cidrContains(all, ip("203.0.113.9"))).toBe(true);
  });

  it("ISO 3166-1 alpha-2", () => {
    expect(isIsoCountryCode("US")).toBe(true);
    expect(isIsoCountryCode("GB")).toBe(true);
    expect(isIsoCountryCode("UK")).toBe(false);
    expect(isIsoCountryCode("XX")).toBe(false);
  });
});
