import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PUBLIC_THEME_COLOR, resolvePublicThemeColor } from "./publicEventPageBranding";

test("public theme colors accept only six-digit hex values", () => {
  assert.equal(resolvePublicThemeColor("#12AbEf"), "#12abef");
  assert.equal(resolvePublicThemeColor("red;}</style><script>alert(1)</script>"), DEFAULT_PUBLIC_THEME_COLOR);
  assert.equal(resolvePublicThemeColor("javascript:alert(1)"), DEFAULT_PUBLIC_THEME_COLOR);
});
