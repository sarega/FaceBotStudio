import assert from "node:assert/strict";
import test from "node:test";

import { SqliteAppDatabase } from "./sqliteAdapter";

test("outreach campaign tracks targets, draft revisions, and approval", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const event = await db.createEvent({ name: "Outreach test", organizer_id: "org_default" });
  const campaign = await db.createOutreachCampaign({ event_id: event.id, name: "Press test", context: "Known facts only" });
  const target = await db.createOutreachTarget({ event_id: event.id, campaign_id: campaign.id, name: "Arts Desk", organization_type: "arts media" });

  const first = await db.createOutreachDraft({ event_id: event.id, target_id: target.id, body: "Draft one" });
  const second = await db.createOutreachDraft({ event_id: event.id, target_id: target.id, body: "Draft two", kind: "suggested_reply", source_message_id: 42 });
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal((await db.approveOutreachDraft(second.id, event.id, "")).approval_status, "approved");

  const refreshed = await db.getOutreachCampaign(campaign.id, event.id);
  assert.equal(refreshed?.target_count, 1);
  assert.equal((await db.listOutreachDrafts(target.id, event.id)).length, 2);
  assert.equal((await db.getOutreachDraft(second.id, event.id))?.kind, "suggested_reply");
  assert.equal((await db.getOutreachDraft(second.id, event.id))?.source_message_id, 42);

  const bound = await db.bindOutreachTargetIdentity(target.id, event.id, "page-1", "sender-1");
  assert.equal(bound?.bound_page_id, "page-1");
  assert.equal(bound?.bound_sender_id, "sender-1");
  assert.equal(bound?.delivery_mode, "manual_only");

  const replied = await db.markOutreachTargetReplied(target.id, event.id, new Date().toISOString());
  assert.equal(replied?.status, "replied");
  assert.equal(replied?.delivery_mode, "api_reply_eligible");
  assert.ok(replied?.last_replied_at);
  assert.equal((await db.findOutreachTargetIdentityMatches("page-1", "sender-1", [event.id])).length, 1);
  const campaignAfterReply = await db.getOutreachCampaign(campaign.id, event.id);
  assert.equal(campaignAfterReply?.needs_action_count, 1);
  assert.equal((await db.listOutreachTargetsForEvent(event.id)).length, 1);

  const delivery = await db.createOutreachDelivery({
    target_id: target.id,
    campaign_id: campaign.id,
    event_id: event.id,
    draft_id: second.id,
    kind: "text",
    channel_platform: "facebook",
    channel_external_id: "page-1",
    recipient_id: "sender-1",
    idempotency_key: "draft:test:text",
    sent_by_user_id: null,
  });
  assert.equal((await db.getOutreachDeliveryByIdempotency(event.id, "draft:test:text"))?.id, delivery.id);
  const sent = await db.updateOutreachDelivery(delivery.id, event.id, { status: "sent", external_message_id: "mid-1" });
  assert.equal(sent?.status, "sent");
  assert.equal(sent?.external_message_id, "mid-1");
  await assert.rejects(() => db.createOutreachDelivery({
    target_id: target.id,
    campaign_id: campaign.id,
    event_id: event.id,
    draft_id: second.id,
    kind: "text",
    channel_platform: "facebook",
    channel_external_id: "page-1",
    recipient_id: "sender-1",
    idempotency_key: "draft:test:text",
  }));
});

test("outreach target status records the first contact timestamp", async () => {
  const db = new SqliteAppDatabase(":memory:");
  await db.initialize();
  const event = await db.createEvent({ name: "Outreach status test", organizer_id: "org_default" });
  const campaign = await db.createOutreachCampaign({ event_id: event.id, name: "Status test" });
  const target = await db.createOutreachTarget({ event_id: event.id, campaign_id: campaign.id, name: "University", organization_type: "university" });

  const updated = await db.updateOutreachTarget(target.id, event.id, {
    event_id: event.id,
    campaign_id: campaign.id,
    name: target.name,
    facebook_page_url: target.facebook_page_url,
    organization_type: target.organization_type,
    notes: target.notes,
    priority: target.priority,
    status: "contacted",
    delivery_mode: "manual_first_contact",
  });
  assert.equal(updated?.status, "contacted");
  assert.ok(updated?.last_contacted_at);
});
