export type PromoGateRequirement = "request" | "selection" | "image_checklist";

export type PromoGate = {
  id: string;
  code: string;
  label: string;
  requirement: PromoGateRequirement;
  expires_at?: string;
};

const PROMO_GATE_LINE = /^\s*\[\[PROMO_GATE\s+(.+)\]\]\s*$/;

export function parsePromoGates(context: string) {
  const gates: PromoGate[] = [];
  const safeLines: string[] = [];

  for (const line of String(context || "").split(/\r?\n/)) {
    const match = line.match(PROMO_GATE_LINE);
    if (!match) {
      safeLines.push(line);
      continue;
    }

    try {
      const value = JSON.parse(match[1]) as Partial<PromoGate>;
      const id = String(value.id || "").trim();
      const code = String(value.code || "").trim();
      const label = String(value.label || "").trim();
      const requirement = value.requirement;
      if (id && code && label && (requirement === "request" || requirement === "selection" || requirement === "image_checklist")) {
        const expires_at = String(value.expires_at || "").trim() || undefined;
        gates.push({ id, code, label, requirement, expires_at });
      }
    } catch {
      // Invalid directives stay hidden from the model and simply cannot release a code.
    }
  }

  return { safeContext: safeLines.join("\n").trim(), gates };
}

export function buildPromoGateInstruction(gates: PromoGate[]) {
  if (gates.length === 0) return "";

  const options = gates.map((gate) =>
    `- promo_id "${gate.id}": ${gate.label}; gate: ${
      gate.requirement === "image_checklist"
        ? "the current user message must contain image evidence visibly showing page follow, public post share, and friend tag"
        : gate.requirement === "selection"
          ? "the user must explicitly select this show"
          : "the user must explicitly ask for this promotion; no other proof or condition is required"
    }`,
  );

  return [
    "Protected Promotion Rules:",
    "Never invent, reveal, quote, list, or guess any promotion code.",
    "Do not claim a promotion is approved without calling releasePromoCode.",
    "Ask only for the next missing requirement.",
    "For image evidence, inspect the current attached image. Call releasePromoCode only when all three checklist items are visibly present; otherwise say exactly what is missing.",
    "For a show-selection promotion, call releasePromoCode only after the user explicitly identifies one listed show.",
    "For a request-only promotion, call releasePromoCode as soon as the user asks for that promotion. Do not ask for proof or repeat conditions from old conversation history.",
    ...options,
  ].join("\n");
}

export function sanitizeProtectedPromoCodes(text: string, gates: PromoGate[], allowedCodes: string[] = []) {
  const allowed = new Set(allowedCodes);
  let safeText = String(text || "");
  for (const gate of gates) {
    if (!allowed.has(gate.code)) {
      const escapedCode = gate.code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      safeText = safeText.replace(new RegExp(escapedCode, "gi"), "[รหัสถูกป้องกัน]");
    }
  }
  return safeText;
}

export function evaluatePromoGate(
  gate: PromoGate | undefined,
  args: Record<string, unknown>,
  hasCurrentImage: boolean,
  hasPriorShowQuestion = false,
  now = new Date(),
) {
  if (!gate) {
    return { approved: false as const, message: "ไม่พบโปรโมชั่นนี้ กรุณาเลือกโปรโมชั่นจากรายการที่แจ้งไว้" };
  }
  if (gate.expires_at && Number.isFinite(Date.parse(gate.expires_at)) && now.getTime() > Date.parse(gate.expires_at)) {
    return { approved: false as const, message: "โปรโมชั่นนี้หมดเขตแล้ว" };
  }

  if (gate.requirement === "image_checklist") {
    if (!hasCurrentImage) {
      return { approved: false as const, message: "กรุณาส่งภาพหลักฐานก่อนรับรหัสส่วนลด" };
    }
    const complete = ["followed_page", "shared_public", "tagged_friend"].every((key) => args[key] === true);
    if (!complete) {
      return { approved: false as const, message: "หลักฐานยังไม่ครบทั้งการติดตามเพจ แชร์แบบสาธารณะ และแท็กเพื่อน" };
    }
  } else if (gate.requirement === "selection" && !hasPriorShowQuestion) {
    return { approved: false as const, message: "ต้องถามผู้ใช้ก่อนว่าต้องการชมรอบใด แล้วรอคำตอบก่อนปล่อยรหัส" };
  }

  return { approved: true as const, code: gate.code, label: gate.label };
}

export function historyHasShowQuestion(historyTexts: string[]) {
  return historyTexts.some((text) =>
    /(รอบไหน|รอบใด|เลือกรอบ|ต้องการ.*รอบ|which show|which performance)/i.test(String(text || "")),
  );
}
