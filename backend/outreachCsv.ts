export function parseOutreachCsv(value: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const text = String(value || "").replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((part) => part)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some((part) => part)) rows.push(row);
  if (rows.length === 0) return [] as Array<Record<string, string>>;
  const headers = rows.shift()!.map((header) => header.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}
