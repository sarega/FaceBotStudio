export type EventSelectionCandidate = {
  id: string;
  name: string;
};

const CHANGE_EVENT_COMMANDS = new Set([
  "change event",
  "switch event",
  "choose event",
  "events",
  "เปลี่ยนงาน",
  "เลือกงาน",
  "เปลี่ยนอีเวนต์",
  "เลือกอีเวนต์",
]);

function normalize(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase();
}

export function isChangeEventCommand(text: string) {
  return CHANGE_EVENT_COMMANDS.has(normalize(text));
}

export function matchEventSelection(text: string, candidates: EventSelectionCandidate[]) {
  const normalized = normalize(text);
  const numberMatch = normalized.match(/^(?:(?:event|งาน|อีเวนต์)\s*)?#?\s*(\d+)$/u);
  if (numberMatch) {
    return candidates[Number(numberMatch[1]) - 1];
  }
  return candidates.find((event) => normalize(event.name) === normalized);
}

export type SelectionLanguage = "th" | "en" | "ja" | "zh" | "ko" | "es" | "fr" | "mixed";

/** Use only explicit script/word evidence; neutral event numbers get a bilingual fallback. */
export function detectSelectionLanguage(message: string): SelectionLanguage {
  const text = String(message || "").trim();
  if (/[\u0E00-\u0E7F]/u.test(text)) return "th";
  if (/[\u3040-\u30FF]/u.test(text)) return "ja";
  if (/[\uAC00-\uD7AF]/u.test(text)) return "ko";
  if (/[\u3400-\u9FFF]/u.test(text)) return "zh";
  if (/\b(?:hola|evento|eventos|cambiar|elegir|seleccionar|quiero|gracias)\b/i.test(text)) return "es";
  if (/\b(?:bonjour|événement|évènements|choisir|changer|merci)\b/i.test(text)) return "fr";
  if (/[a-z]/i.test(text)) return "en";
  return "mixed";
}

const SELECTION_COPY: Record<SelectionLanguage, [string, string, string]> = {
  th: ["กรุณาเลือกงานที่ต้องการสอบถาม", "ตอบเป็นหมายเลขหรือชื่องาน", "เลือก {event} แล้ว กรุณาส่งคำถามได้เลย"],
  en: ["Please choose the event you want to ask about.", "Reply with the number or event name.", "{event} selected. Please send your question."],
  ja: ["お問い合わせのイベントを選択してください。", "番号またはイベント名で返信してください。", "{event} を選択しました。ご質問をどうぞ。"],
  zh: ["请选择您要咨询的活动。", "请回复编号或活动名称。", "已选择 {event}，请发送您的问题。"],
  ko: ["문의하실 행사를 선택해 주세요.", "번호 또는 행사 이름으로 답장해 주세요.", "{event} 선택 완료. 질문을 보내 주세요."],
  es: ["Elija el evento sobre el que desea consultar.", "Responda con el número o el nombre del evento.", "Ha seleccionado {event}. Envíe su pregunta."],
  fr: ["Veuillez choisir l’événement concerné.", "Répondez avec le numéro ou le nom de l’événement.", "Vous avez sélectionné {event}. Posez votre question."],
  mixed: ["กรุณาเลือกงานที่ต้องการสอบถาม\nPlease choose the event you want to ask about.", "ตอบเป็นหมายเลขหรือชื่องาน • Reply with the number or event name.", "เลือก {event} แล้ว กรุณาส่งคำถามได้เลย\n{event} selected. Please send your question."],
};

export function buildEventSelectionPrompt(candidates: EventSelectionCandidate[], customerMessage = "") {
  const choices = candidates.map((event, index) => `${index + 1}. ${event.name}`).join("\n");
  const copy = SELECTION_COPY[detectSelectionLanguage(customerMessage)];
  return [copy[0], "", choices, "", copy[1]].join("\n");
}

export function buildEventSelectedMessage(eventName: string, customerMessage = "") {
  return SELECTION_COPY[detectSelectionLanguage(customerMessage)][2].replaceAll("{event}", eventName);
}
