export type AdminAgentOutreachPriority = "low" | "normal" | "high";

export type AdminAgentOutreachTargetDraft = {
  name: string;
  facebook_page_url: string;
  facebook_page_id: string;
  organization_type: string;
  contact_person: string;
  email: string;
  website: string;
  notes: string;
  priority: AdminAgentOutreachPriority;
  next_follow_up_at: string;
};

export type AdminAgentOutreachAssetDraft = {
  name: string;
  type: string;
  description: string;
  url: string;
  tags: string;
};

export type AdminAgentOutreachDraft = {
  event_id: string;
  campaign: {
    name: string;
    description: string;
    objective: string;
    context: string;
    default_instruction: string;
    start_date: string;
    end_date: string;
    status: "draft" | "active" | "paused" | "completed" | "archived";
  };
  targets: AdminAgentOutreachTargetDraft[];
  assets: AdminAgentOutreachAssetDraft[];
};

const MAX_TARGETS = 500;
const MAX_ASSETS = 50;

function text(value: unknown, max = 4000) {
  return String(value ?? "").trim().slice(0, max);
}

function comparable(value: unknown) {
  return text(value, 1000).toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function readObjectList(value: unknown) {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  if (value && typeof value === "object") return [value as Record<string, unknown>];
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      : parsed && typeof parsed === "object" ? [parsed as Record<string, unknown>] : [];
  } catch {
    return [];
  }
}

function firstValue(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return "";
}

function normalizeUrl(value: unknown) {
  const candidate = text(value, 2048);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? candidate : "";
  } catch {
    return "";
  }
}

function normalizePriority(value: unknown): AdminAgentOutreachPriority {
  const normalized = comparable(value);
  return normalized === "low" || normalized === "high" ? normalized : "normal";
}

function normalizeStatus(value: unknown): AdminAgentOutreachDraft["campaign"]["status"] {
  const normalized = comparable(value);
  return normalized === "active" || normalized === "paused" || normalized === "completed" || normalized === "archived"
    ? normalized
    : "draft";
}

export function normalizeAdminAgentOutreachDraft(args: Record<string, unknown>, eventId: string) {
  const campaignName = firstValue(args, "campaign_name", "name");
  const errors: string[] = [];
  if (!campaignName) errors.push("campaign_name");

  const rawTargets = readObjectList(args.targets);
  if (rawTargets.length > MAX_TARGETS) errors.push(`targets มากกว่า ${MAX_TARGETS} รายการ`);
  const targets = rawTargets.slice(0, MAX_TARGETS).map((source) => ({
    name: firstValue(source, "name", "target_name", "organization_name"),
    facebook_page_url: normalizeUrl(source.facebook_page_url || source.page_url || source.facebook_url),
    facebook_page_id: firstValue(source, "facebook_page_id", "page_id"),
    organization_type: firstValue(source, "organization_type", "type") || "other",
    contact_person: firstValue(source, "contact_person", "contact", "person"),
    email: firstValue(source, "email"),
    website: normalizeUrl(source.website || source.web_url),
    notes: [
      firstValue(source, "notes", "note", "description"),
      firstValue(source, "phone", "telephone") ? `Phone: ${firstValue(source, "phone", "telephone")}` : "",
      normalizeUrl(source.source_url || source.source) ? `Source: ${normalizeUrl(source.source_url || source.source)}` : "",
    ].filter(Boolean).join("\n"),
    priority: normalizePriority(source.priority),
    next_follow_up_at: firstValue(source, "next_follow_up_at", "follow_up_at"),
  }));
  targets.forEach((target, index) => {
    if (!target.name) errors.push(`targets[${index}].name`);
  });

  const rawAssets = readObjectList(args.assets || args.press_kit || args.press_kit_assets);
  if (rawAssets.length > MAX_ASSETS) errors.push(`assets มากกว่า ${MAX_ASSETS} รายการ`);
  const assets = rawAssets.slice(0, MAX_ASSETS).map((source) => ({
    name: firstValue(source, "name", "asset_name"),
    type: firstValue(source, "type") || "other",
    description: firstValue(source, "description", "notes"),
    url: normalizeUrl(source.url || source.asset_url),
    tags: firstValue(source, "tags", "tag"),
  }));
  assets.forEach((asset, index) => {
    if (!asset.name) errors.push(`assets[${index}].name`);
    if (!asset.url) errors.push(`assets[${index}].url ต้องเป็น http(s)`);
  });

  return {
    draft: errors.length > 0 ? null : ({
      event_id: text(args.event_id, 120) || text(eventId, 120),
      campaign: {
        name: campaignName,
        description: firstValue(args, "description"),
        objective: firstValue(args, "objective"),
        context: firstValue(args, "context"),
        default_instruction: firstValue(args, "default_instruction", "instruction"),
        start_date: firstValue(args, "start_date"),
        end_date: firstValue(args, "end_date"),
        status: normalizeStatus(args.status),
      },
      targets,
      assets,
    } satisfies AdminAgentOutreachDraft),
    errors,
  };
}

export function isAdminAgentConfirmation(value: unknown) {
  const normalized = comparable(value).replace(/[.!?。！？]+$/g, "").trim();
  return /^(ยืนยัน|ตกลง|ทำเลย|สร้างเลย|ดำเนินการ|confirm|yes|ok|okay|go ahead|proceed|approve)(?:\s*(ครับ|ค่ะ|ได้เลย|เลย))?$/.test(normalized);
}

export function isAdminAgentCancellation(value: unknown) {
  const normalized = comparable(value).replace(/[.!?。！？]+$/g, "").trim();
  return /^(ยกเลิก|ไม่ทำ|ไม่ต้องทำ|cancel|stop|no|ไม่ยืนยัน)$/.test(normalized);
}

export function getAdminAgentOutreachIdentityKeys(target: {
  name?: unknown;
  facebook_page_url?: unknown;
  facebook_page_id?: unknown;
  email?: unknown;
}) {
  const keys = [
    ["page_url", target.facebook_page_url],
    ["page_id", target.facebook_page_id],
    ["email", target.email],
  ]
    .map(([kind, value]) => `${kind}:${comparable(value)}`)
    .filter((key) => !key.endsWith(":"));
  return keys;
}

export function formatAdminAgentOutreachDraftSummary(draft: AdminAgentOutreachDraft) {
  const lines = [
    "สรุปสิ่งที่จะตั้งค่า (ยังไม่บันทึก)",
    `แคมเปญ: ${draft.campaign.name}`,
    `Event: ${draft.event_id}`,
    `สถานะ: ${draft.campaign.status}`,
    draft.campaign.objective ? `เป้าหมาย: ${draft.campaign.objective}` : "",
    draft.campaign.context ? `Context: ${draft.campaign.context.slice(0, 280)}` : "",
    `Targets: ${draft.targets.length} รายการ`,
  ].filter(Boolean);
  for (const target of draft.targets.slice(0, 12)) {
    lines.push(`- ${target.name} • ${target.organization_type}${target.email ? ` • ${target.email}` : ""}${target.facebook_page_url ? ` • ${target.facebook_page_url}` : ""}`);
  }
  if (draft.targets.length > 12) lines.push(`- และอีก ${draft.targets.length - 12} รายการ`);
  lines.push(`Press Kit: ${draft.assets.length} รายการ`);
  for (const asset of draft.assets.slice(0, 8)) lines.push(`- ${asset.name} • ${asset.url}`);
  if (draft.assets.length > 8) lines.push(`- และอีก ${draft.assets.length - 8} รายการ`);
  lines.push('พิมพ์ "ยืนยัน" เพื่อบันทึก หรือ "ยกเลิก" เพื่อไม่ทำรายการนี้');
  return lines.join("\n");
}
