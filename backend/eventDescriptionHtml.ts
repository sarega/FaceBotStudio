import sanitizeHtml from "sanitize-html";

export function sanitizeEventDescriptionHtml(value: string | null | undefined) {
  return sanitizeHtml(String(value || ""), {
    allowedTags: ["h2", "h3", "h4", "p", "div", "span", "font", "br", "strong", "em", "u", "s", "ul", "ol", "li", "blockquote", "a", "img", "hr"],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "title", "loading"],
      font: ["color"],
      div: ["style"],
      p: ["style"],
      h2: ["style"],
      h3: ["style"],
      h4: ["style"],
      span: ["style"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\([\d\s,.%]+\)$/i],
        "text-align": [/^(left|center|right|justify)$/],
      },
    },
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      img: (_tagName, attribs) => ({
        tagName: "img",
        attribs: {
          src: attribs.src || "",
          alt: attribs.alt || "Event content image",
          loading: "lazy",
        },
      }),
    },
  }).trim();
}
