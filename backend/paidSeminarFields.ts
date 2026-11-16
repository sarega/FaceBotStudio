export const paidSeminarFields = {
  arrival: { label: "Arrival date", type: "date" },
  departure: { label: "Departure date", type: "date" },
  accommodation: { label: "Accommodation needed", type: "boolean" },
  room_preference: { label: "Room preference", type: "text" },
  transport: { label: "Transport preference", type: "text" },
  food: { label: "Food preference", type: "text" },
  notes: { label: "Additional notes", type: "text" },
} as const;

export type PaidSeminarKey = keyof typeof paidSeminarFields;
export type PaidSeminarField = { key: PaidSeminarKey; scope: "booking" | "attendee"; required: boolean };
export type PaidSeminarAnswer = { key: PaidSeminarKey; label: string; value: string };

export function parsePaidSeminarFields(value: unknown): PaidSeminarField[] | undefined {
  if (!Array.isArray(value) || value.length > Object.keys(paidSeminarFields).length) return;
  const result: PaidSeminarField[] = [];
  const keys = new Set<string>();
  for (const row of value) {
    if (!row || typeof row.key !== "string" || !Object.hasOwn(paidSeminarFields, row.key) || keys.has(row.key) ||
        (row.scope !== "booking" && row.scope !== "attendee") || typeof row.required !== "boolean") return;
    keys.add(row.key);
    result.push({ key: row.key, scope: row.scope, required: row.required });
  }
  return result;
}

export function normalizePaidSeminarAnswers(
  fields: PaidSeminarField[], scope: PaidSeminarField["scope"], raw: unknown,
): PaidSeminarAnswer[] | undefined {
  if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw))) return;
  const values = (raw ?? {}) as Record<string, unknown>;
  const matching = fields.filter((field) => field.scope === scope);
  if (Object.keys(values).some((key) => !matching.some((field) => field.key === key))) return;
  const answers: PaidSeminarAnswer[] = [];
  for (const field of matching) {
    const value = values[field.key];
    if (value !== undefined && typeof value !== "string") return;
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) {
      if (field.required) return;
      continue;
    }
    const definition = paidSeminarFields[field.key];
    if (text.length > 500 || (definition.type === "boolean" && text !== "yes" && text !== "no")) return;
    if (definition.type === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return;
      const date = new Date(text);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) return;
    }
    answers.push({ key: field.key, label: definition.label, value: text });
  }
  return answers;
}
