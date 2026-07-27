const PROMO_GATE_LINE = /^\s*\[\[PROMO_GATE\s+.+\]\]\s*$/;

export function splitContextForEditor(context: string) {
  const visibleLines: string[] = [];
  const gateLines: string[] = [];
  for (const line of String(context || "").split(/\r?\n/)) {
    if (PROMO_GATE_LINE.test(line)) gateLines.push(line.trim());
    else visibleLines.push(line);
  }
  return { visibleContext: visibleLines.join("\n"), gateLines };
}

export function composeContextFromEditor(visibleContext: string, gateLines: string[]) {
  if (!visibleContext) return "";
  if (gateLines.length === 0) return visibleContext;
  return `${visibleContext}\n${gateLines.join("\n")}`;
}
