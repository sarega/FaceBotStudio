import assert from "node:assert/strict";
import test from "node:test";

import { getInstagramWebhookEventText } from "./instagramQueue";

test("normalizes Instagram direct, quick reply, postback, and Ads referral events", () => {
  assert.equal(getInstagramWebhookEventText({ message: { text: "สนใจสมัครงาน" } }), "สนใจสมัครงาน");
  assert.equal(getInstagramWebhookEventText({ message: { quick_reply: { payload: "ดูรอบการแสดง" } } }), "ดูรอบการแสดง");
  assert.equal(getInstagramWebhookEventText({ postback: { payload: "ดูราคา" } }), "ดูราคา");
  assert.equal(
    getInstagramWebhookEventText({
      referral: {
        source: "ADS",
        type: "OPEN_THREAD",
        ads_context_data: { ad_title: "คอนเสิร์ตเสียงไทยคอรัส" },
      },
    }),
    "คอนเสิร์ตเสียงไทยคอรัส",
  );
  assert.equal(
    getInstagramWebhookEventText({ referral: { source: "ADS", type: "OPEN_THREAD" } }),
    "ผู้ใช้เปิดแชตจากโฆษณา Instagram",
  );
});
