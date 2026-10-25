import sanitizeHtml from "sanitize-html";

export function sanitizeEventDescriptionHtml(value: string | null | undefined) {
  return sanitizeHtml(String(value || ""), {
    allowedTags: ["section", "header", "h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "span", "font", "br", "strong", "b", "em", "i", "u", "s", "strike", "del", "sub", "sup", "small", "pre", "code", "ul", "ol", "li", "blockquote", "a", "figure", "figcaption", "img", "hr", "table", "caption", "colgroup", "col", "thead", "tbody", "tfoot", "tr", "th", "td"],
    allowedAttributes: {
      "*": ["style", "lang"],
      a: ["href", "target", "rel", "title"],
      img: ["src", "alt", "title", "loading", "width", "height", "class"],
      font: ["color", "face", "size", "style"],
      table: ["style", "class", "width", "height"],
      col: ["style", "width"],
      td: ["style", "colspan", "rowspan", "width", "height"],
      th: ["style", "colspan", "rowspan", "width", "height", "scope"],
    },
    allowedClasses: { img: ["fr-fic", "fr-dib", "fr-dii", "fr-fil", "fr-fir"], table: ["fr-alternate-rows"] },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i, /^[a-z]+$/i],
        "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i, /^(?:transparent|[a-z]+)$/i],
        // Includes the standard font stacks emitted by Froala when HTML is pasted in.
        "font-family": [/^(?:(?:['"]?(?:Sarabun|Noto Sans Thai|Arial|Helvetica|Tahoma|Geneva|Georgia|Times New Roman|Times|Verdana|Impact|Charcoal)['"]?|sans-serif|serif|-webkit-standard)\s*,\s*)*(?:['"]?(?:Sarabun|Noto Sans Thai|Arial|Helvetica|Tahoma|Geneva|Georgia|Times New Roman|Times|Verdana|Impact|Charcoal)['"]?|sans-serif|serif|-webkit-standard)$/i],
        "font-size": [/^(?:[8-9]|[1-9]\d)px$/, /^clamp\(\s*\d+(?:\.\d+)?(?:px|rem|em|vw)\s*,\s*\d+(?:\.\d+)?(?:px|rem|em|vw)\s*,\s*\d+(?:\.\d+)?(?:px|rem|em|vw)\s*\)$/i],
        "line-height": [/^(?:normal|\d+(?:\.\d+)?(?:px|rem|em|%)?)$/i],
        margin: [/^(?:auto|\d+(?:\.\d+)?(?:px|rem|em|%)?)(?:\s+(?:auto|\d+(?:\.\d+)?(?:px|rem|em|%)?)){0,3}$/i],
        "border-radius": [/^\d+(?:\.\d+)?(?:px|rem|em|%)?(?:\s+\d+(?:\.\d+)?(?:px|rem|em|%)?){0,3}$/i],
        background: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i, /^[a-z]+$/i],
        "border-top": [/^(?:none|\d+(?:\.\d+)?(?:px)?\s+(?:solid|dashed|dotted)\s+(?:#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s,.%]+\)))$/i],
        "font-weight": [/^(?:normal|bold|[1-9]00)$/i],
        "font-style": [/^(?:normal|italic)$/i],
        "text-decoration": [/^(?:none|underline|line-through)(?:\s+(?:underline|line-through))?$/i],
        "text-align": [/^(left|center|right|justify)$/],
        "vertical-align": [/^(?:top|middle|bottom|baseline)$/],
        float: [/^(?:left|right|none)$/],
        width: [/^(?:auto|\d+(?:\.\d+)?(?:px|%))$/],
        "max-width": [/^(?:none|\d+(?:\.\d+)?(?:px|%))$/],
        height: [/^(?:auto|\d+(?:\.\d+)?px)$/],
        "margin-left": [/^(?:auto|\d+(?:\.\d+)?(?:px|rem|em|%))$/],
        "margin-right": [/^(?:auto|\d+(?:\.\d+)?(?:px|rem|em|%))$/],
        "margin-top": [/^(?:auto|\d+(?:\.\d+)?(?:px|rem|em|%))$/],
        "margin-bottom": [/^(?:auto|\d+(?:\.\d+)?(?:px|rem|em|%))$/],
        padding: [/^\d+(?:\.\d+)?(?:px|rem|em|%)?(?:\s+\d+(?:\.\d+)?(?:px|rem|em|%)?){0,3}$/],
        border: [/^(?:none|\d+(?:\.\d+)?px\s+(?:solid|dashed|dotted)\s+(?:#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s,.%]+\)))$/i],
        "border-collapse": [/^(?:collapse|separate)$/],
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
          ...attribs,
          src: attribs.src || "",
          alt: attribs.alt || "Event content image",
          loading: "lazy",
        },
      }),
    },
  }).trim();
}
