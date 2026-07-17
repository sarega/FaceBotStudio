const EVENT_DESCRIPTION_TAGS = [
  "h2",
  "h3",
  "h4",
  "p",
  "div",
  "span",
  "font",
  "br",
  "strong",
  "em",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
  "img",
  "hr",
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
  const safeRules = value
    .split(";")
    .map((rule) => rule.trim())
    .filter((rule) => /^(text-align\s*:\s*(left|center|right|justify)|color\s*:\s*(#[0-9a-f]{3,8}|rgb\([\d\s,.%]+\)))$/i.test(rule));
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
    const originalColor = tagName === "font" ? element.getAttribute("color") || "" : "";
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
    } else if (tagName === "font" && /^(#[0-9a-f]{3,8}|rgb\([\d\s,.%]+\))$/i.test(originalColor)) {
      element.setAttribute("color", originalColor);
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
