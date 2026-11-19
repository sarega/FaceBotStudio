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
export type PaidSeminarField = {
  key: PaidSeminarKey; scope: "booking" | "attendee"; required: boolean;
  /** Optional chosen answer for new registrations; historical answers remain unchanged. */
  defaultValue?: string;
  /** Optional select choices. Food and Transport may be configured as free text or select. */
  options?: string[];
};

export const foodPreferencePresets = ["Vegetarian", "Non-vegetarian"] as const;

export const transportPreferencePresets = ["Self-arranged", "Need transport"] as const;

export type EditableSeminarKey = Exclude<PaidSeminarKey, "accommodation">;

export function isEditableSeminarKey(key: unknown): key is EditableSeminarKey {
  return typeof key === "string" && key !== "accommodation" && Object.hasOwn(paidSeminarFields, key);
}

export type PaidSeminarAnswer = { key: PaidSeminarKey; label: string; value: string };

export function parsePaidSeminarFields(value: unknown): PaidSeminarField[] | undefined {
  if (!Array.isArray(value) || value.length > Object.keys(paidSeminarFields).length) return;
  const result: PaidSeminarField[] = [];
  const keys = new Set<string>();
  for (const row of value) {
    if (!row || typeof row.key !== "string" || !Object.hasOwn(paidSeminarFields, row.key) || keys.has(row.key) ||
        (row.scope !== "booking" && row.scope !== "attendee") || typeof row.required !== "boolean") return;
    const definition = paidSeminarFields[row.key as PaidSeminarKey];
    if (row.defaultValue !== undefined &&
        (typeof row.defaultValue !== "string" || row.defaultValue.length > 500)) return;
    const defaultValue = typeof row.defaultValue === "string" ? row.defaultValue.trim() : "";
    let options: string[] | undefined;
    if (row.options !== undefined) {
      if ((row.key !== "food" && row.key !== "transport") || !Array.isArray(row.options) ||
          row.options.length < 2 || row.options.length > 20 ||
          row.options.some((choice: unknown) => typeof choice !== "string" ||
            choice.trim().length < 1 || choice.trim().length > 80)) return;
      options = row.options.map((choice: string) => choice.trim());
      if (new Set(options.map((choice) => choice.toLowerCase())).size !== options.length) return;
    }
    if (definition.type === "boolean" && defaultValue &&
        !["yes", "no"].includes(defaultValue)) return;
    if (definition.type === "date" && defaultValue) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(defaultValue)) return;
      const date = new Date(defaultValue);
      if (!Number.isFinite(date.getTime()) ||
          date.toISOString().slice(0, 10) !== defaultValue) return;
    }
    if (options && defaultValue && !options.includes(defaultValue)) return;
    keys.add(row.key);
    result.push({key:row.key,scope:row.scope,required:row.required,
      ...(defaultValue ? {defaultValue} : {}),
      ...(options ? {options} : {})});
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
    if (text.length > 500 || (definition.type === "boolean" && text !== "yes" && text !== "no") ||
        (field.options && !field.options.includes(text))) return;
    if (definition.type === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return;
      const date = new Date(text);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) return;
    }
    answers.push({ key: field.key, label: definition.label, value: text });
  }
  return answers;
}


/** Used at form load and for new attendees. Defaults are real submitted values. */
export function seminarDefaultAnswers(fields: PaidSeminarField[], scope: PaidSeminarField["scope"]):
  Record<string, string> {
  return Object.fromEntries(fields.filter((field) => field.scope === scope && field.defaultValue)
    .map((field) => [field.key, field.defaultValue!]));
}
