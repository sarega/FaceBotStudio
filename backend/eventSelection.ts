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

export function buildEventSelectionPrompt(candidates: EventSelectionCandidate[]) {
  const choices = candidates.map((event, index) => `${index + 1}. ${event.name}`).join("\n");
  return [
    "กรุณาเลือกงานที่ต้องการสอบถาม",
    "Please choose the event you want to ask about.",
    "",
    choices,
    "",
    "ตอบเป็นหมายเลขหรือชื่องาน • Reply with the number or event name.",
  ].join("\n");
}

export function buildEventSelectedMessage(eventName: string) {
  return `เลือก ${eventName} แล้ว กรุณาส่งคำถามได้เลย\n${eventName} selected. Please send your question.`;
}
