import { describe, expect, it } from "vitest";

import { extractVerificationCode } from "../src/server/domain/extract-code";
import { stripHtml } from "../src/server/email/parse";

describe("extractVerificationCode", () => {
  const cases: Array<[string, string | null]> = [
    // keyword-anchored
    ["Your verification code is 654321", "654321"],
    ["Your verification code is valid for 10 minutes: 482913", "482913"],
    ["Your verification code will expire soon.\n\n482913", "482913"],
    ["Enter the security code below to continue\n\n771122", "771122"],
    ["Your code: 123-456", "123456"],
    ["Your code is 123 456", "123456"],
    ["Ihr Code lautet 123456", "123456"],
    ["Tu código de verificación es 998877", "998877"],
    ["OTP: 4821", "4821"],
    ["Your one-time passcode is 7K3PQ2", "7K3PQ2"],
    ["Sign-in code\n\n445566\n\nThis code expires in 5 minutes.", "445566"],
    ["Use this PIN code 2468 to unlock", "2468"],
    // conservative fallback without a keyword
    ["Use 112233 to finish signing in", "112233"],
    ["Welcome back, there is nothing to verify here.", null],
    ["© 2024 Netflix, Inc. 100 Winchester Circle, Los Gatos, CA 95032", null],
    ["Order #123456 has shipped. Track it at 555 0100 ext 4433", null],
    ["Two codes 111111 and 222222 are both in here", null],
    // rejections around keywords
    ["Your code is valid until 2026. Thanks!", null],
    ["Promo code SUMMER applies; nothing numeric", null],
  ];

  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input.slice(0, 60))} → ${JSON.stringify(expected)}`, () => {
      expect(extractVerificationCode(input)).toBe(expected);
    });
  }
});

describe("stripHtml", () => {
  it("drops style/script blocks, decodes entities and keeps the code", () => {
    const html =
      "<html><head><style>.btn{color:#123456;width:600px}</style></head>" +
      "<body><p>Hello&nbsp;there, your code is&#160;<b>778899</b> &amp; expires soon.</p>" +
      "<script>var x = 999999;</script></body></html>";

    const text = stripHtml(html);
    expect(text).not.toContain("123456");
    expect(text).not.toContain("999999");
    expect(text).toContain("Hello there, your code is 778899 & expires soon.");
    expect(extractVerificationCode(text)).toBe("778899");
  });
});
