const EVENT_DESCRIPTION_TAGS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "div",
  "span",
  "font",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "del",
  "sub",
  "sup",
  "small",
  "pre",
  "code",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
  "figure",
  "figcaption",
  "img",
  "hr",
  "table",
  "caption",
  "colgroup",
  "col",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
] as const;

const ALLOWED_TAG_SET = new Set<string>(EVENT_DESCRIPTION_TAGS);

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isSafeHref(value: string) {
  return /^(https?:|mailto:|tel:|\/|#)/i.test(value.trim());
}

function sanitizeInlineStyle(value: string) {
  const safeColor = "(?:#[0-9a-f]{3,8}|rgba?\\([\\d\\s,.%]+\\)|[a-z]+)";
  const safeLength = "\\d+(?:\\.\\d+)?(?:px|rem|em|%)";
  const rules = [
    new RegExp(`^text-align\\s*:\\s*(left|center|right|justify)$`, "i"),
    new RegExp(`^(color|background-color)\\s*:\\s*${safeColor}$`, "i"),
    /^font-family\s*:\s*(?:Sarabun|Noto Sans Thai|Tahoma|Arial|Georgia|Times New Roman)(?:\s*,\s*(?:sans-serif|serif))?$/i,
    /^font-size\s*:\s*(?:[8-9]|[1-9]\d)px$/i,
    /^font-weight\s*:\s*(?:normal|bold|[1-9]00)$/i,
    /^font-style\s*:\s*(?:normal|italic)$/i,
    /^text-decoration\s*:\s*(?:none|underline|line-through)(?:\s+(?:underline|line-through))?$/i,
    /^vertical-align\s*:\s*(?:top|middle|bottom|baseline)$/i,
    /^float\s*:\s*(?:left|right|none)$/i,
    new RegExp(`^(width|max-width)\\s*:\\s*(?:auto|${safeLength})$`, "i"),
    /^height\s*:\s*(?:auto|\d+(?:\.\d+)?px)$/i,
    new RegExp(`^margin-(left|right|top|bottom)\\s*:\\s*(?:auto|${safeLength})$`, "i"),
    new RegExp(`^padding\\s*:\\s*${safeLength.replace("(?:px|rem|em|%)", "(?:px|rem|em|%)?")}(?:\\s+${safeLength.replace("(?:px|rem|em|%)", "(?:px|rem|em|%)?")}){0,3}$`, "i"),
    new RegExp(`^border\\s*:\\s*(?:none|\\d+(?:\\.\\d+)?px\\s+(?:solid|dashed|dotted)\\s+${safeColor})$`, "i"),
    /^border-collapse\s*:\s*(?:collapse|separate)$/i,
  ];
  const safeRules = value
    .split(";")
    .map((rule) => rule.trim())
    .filter((rule) => rules.some((pattern) => pattern.test(rule)));
  return safeRules.join("; ");
}

export function sanitizeEventDescriptionHtml(value: string | null | undefined) {
  const source = String(value || "");
  if (typeof DOMParser === "undefined") {
    return escapeHtml(source);
  }

  const documentNode = new DOMParser().parseFromString(`<div>${source}</div>`, "text/html");
  const root = documentNode.body.firstElementChild;
  if (!root) return "";

  Array.from(root.querySelectorAll("script,style,iframe,object,embed,form,input,button,svg,math")).forEach((element) => element.remove());
  Array.from(root.querySelectorAll("*")).reverse().forEach((element) => {
    const tagName = element.tagName.toLowerCase();
    if (!ALLOWED_TAG_SET.has(tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }

    const originalHref = tagName === "a" ? element.getAttribute("href") || "" : "";
    const originalSrc = tagName === "img" ? element.getAttribute("src") || "" : "";
    const originalAlt = tagName === "img" ? element.getAttribute("alt") || "" : "";
    const originalTitle = element.getAttribute("title") || "";
    const originalWidth = tagName === "img" ? element.getAttribute("width") || "" : "";
    const originalHeight = tagName === "img" ? element.getAttribute("height") || "" : "";
    const originalClass = element.getAttribute("class") || "";
    const originalColspan = element.getAttribute("colspan") || "";
    const originalRowspan = element.getAttribute("rowspan") || "";
    const originalColor = tagName === "font" ? element.getAttribute("color") || "" : "";
    const originalFace = tagName === "font" ? element.getAttribute("face") || "" : "";
    const originalSize = tagName === "font" ? element.getAttribute("size") || "" : "";
    const originalStyle = element.getAttribute("style") || "";
    Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name));
    if (tagName === "a") {
      const sourceAnchor = element as HTMLAnchorElement;
      if (isSafeHref(originalHref)) {
        sourceAnchor.setAttribute("href", originalHref);
        sourceAnchor.setAttribute("target", "_blank");
        sourceAnchor.setAttribute("rel", "noopener noreferrer");
      }
    } else if (tagName === "img" && isSafeHref(originalSrc)) {
      element.setAttribute("src", originalSrc);
      element.setAttribute("alt", originalAlt || "Event content image");
      element.setAttribute("loading", "lazy");
      if (originalTitle) element.setAttribute("title", originalTitle);
      if (/^\d{1,4}$/.test(originalWidth)) element.setAttribute("width", originalWidth);
      if (/^\d{1,4}$/.test(originalHeight)) element.setAttribute("height", originalHeight);
      const safeClasses = originalClass.split(/\s+/).filter((item) => ["fr-fic", "fr-dib", "fr-dii", "fr-fil", "fr-fir"].includes(item));
      if (safeClasses.length) element.setAttribute("class", safeClasses.join(" "));
    } else if (tagName === "font") {
      if (/^(#[0-9a-f]{3,8}|rgb\([\d\s,.%]+\))$/i.test(originalColor)) {
        element.setAttribute("color", originalColor);
      }
      if (/^(Sarabun|Noto Sans Thai|Arial|Tahoma|Georgia|Times New Roman)$/i.test(originalFace)) {
        element.setAttribute("face", originalFace);
      }
      if (/^[1-7]$/.test(originalSize)) {
        element.setAttribute("size", originalSize);
      }
    }
    if (["td", "th"].includes(tagName)) {
      if (/^\d{1,2}$/.test(originalColspan)) element.setAttribute("colspan", originalColspan);
      if (/^\d{1,2}$/.test(originalRowspan)) element.setAttribute("rowspan", originalRowspan);
    }
    const safeStyle = sanitizeInlineStyle(originalStyle);
    if (safeStyle) {
      element.setAttribute("style", safeStyle);
    }
  });

  return root.innerHTML.trim();
}

export function eventDescriptionToPlainText(value: string | null | undefined) {
  const source = String(value || "");
  const plain = typeof DOMParser === "undefined"
    ? source.replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|amp|lt|gt|quot|#039);/g, " ")
    : new DOMParser().parseFromString(source, "text/html").body.textContent || "";
  return plain
    .replace(/\s+/g, " ")
    .trim();
}

export function renderEventDescriptionHtml(value: string | null | undefined) {
  const source = String(value || "").trim();
  if (!source) return "";
  if (/<[a-z][\s\S]*>/i.test(source)) {
    return sanitizeEventDescriptionHtml(source);
  }

  return source
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}
