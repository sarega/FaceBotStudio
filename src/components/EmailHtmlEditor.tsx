import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";

type EmailHtmlEditorMode = "code" | "visual" | "rendered";
type EmailQuickBlockId = "hero" | "details" | "cta" | "footer";

type EmailHtmlEditorProps = {
  value: string;
  renderedPreviewHtml: string;
  supportedTokens: string[];
  onChange: (value: string) => void;
};

const CODE_EDITOR_LINE_HEIGHT = 24;

function EmailEditorHelpBubble({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelOffset, setPanelOffset] = useState(0);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!bubbleRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPanelOffset(0);
      return;
    }

    const updatePosition = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const margin = 16;
      const rect = panel.getBoundingClientRect();
      let nextOffset = 0;

      if (rect.left < margin) {
        nextOffset += margin - rect.left;
      }
      if (rect.right > window.innerWidth - margin) {
        nextOffset -= rect.right - (window.innerWidth - margin);
      }

      setPanelOffset(nextOffset);
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={bubbleRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        title={label}
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full z-20 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-xl"
          style={panelOffset ? { transform: `translateX(${panelOffset}px)` } : undefined}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function serializeDocumentWithDoctype(doc: Document) {
  const doctype = doc.doctype;
  if (!doctype) {
    return doc.documentElement.outerHTML;
  }

  let prefix = `<!DOCTYPE ${doctype.name}`;
  if (doctype.publicId) {
    prefix += ` PUBLIC "${doctype.publicId}"`;
  } else if (doctype.systemId) {
    prefix += " SYSTEM";
  }
  if (doctype.systemId) {
    prefix += ` "${doctype.systemId}"`;
  }
  prefix += ">";

  return `${prefix}\n${doc.documentElement.outerHTML}`;
}

function ensureVisualEditorDocument(doc: Document) {
  doc.designMode = "on";
  doc.body?.setAttribute("spellcheck", "false");
  doc.body?.setAttribute("contenteditable", "true");

  if (!doc.getElementById("email-visual-editor-style")) {
    const style = doc.createElement("style");
    style.id = "email-visual-editor-style";
    style.textContent = `
      html, body {
        min-height: 100%;
      }

      body {
        outline: none;
        caret-color: #2563eb;
      }

      *:focus {
        outline: none;
      }
    `;
    doc.head.appendChild(style);
  }
}

function tokenValue(supportedTokens: string[], token: string, fallback: string) {
  return supportedTokens.includes(token) ? `{{${token}}}` : fallback;
}

function firstTokenValue(supportedTokens: string[], tokens: string[], fallback: string) {
  const match = tokens.find((token) => supportedTokens.includes(token));
  return match ? `{{${match}}}` : fallback;
}

function buildDetailsRows(supportedTokens: string[]) {
  const rows: Array<{ label: string; value: string }> = [];

  if (supportedTokens.includes("registration_id")) {
    rows.push({ label: "Registration ID", value: "{{registration_id}}" });
  }
  if (supportedTokens.includes("event_date")) {
    rows.push({ label: "Date", value: "{{event_date}}" });
  }
  if (supportedTokens.includes("event_location")) {
    rows.push({ label: "Location", value: "{{event_location}}" });
  }
  if (supportedTokens.includes("payment_amount")) {
    rows.push({ label: "Amount", value: "{{payment_amount}}" });
  }
  if (supportedTokens.includes("payment_status")) {
    rows.push({ label: "Status", value: "{{payment_status}}" });
  }
  if (supportedTokens.includes("update_summary")) {
    rows.push({ label: "Update", value: "{{update_summary}}" });
  }

  return rows.slice(0, 4);
}

function buildQuickBlockMarkup(blockId: EmailQuickBlockId, supportedTokens: string[]) {
  const eventName = tokenValue(supportedTokens, "event_name", "Your Event");
  const fullName = tokenValue(supportedTokens, "full_name", "Attendee");
  const supportEmail = tokenValue(supportedTokens, "support_email", "support@example.com");
  const primaryUrl = firstTokenValue(
    supportedTokens,
    ["ticket_url", "event_page_url", "magic_link_url", "map_url"],
    "https://example.com",
  );
  const primaryLabel = supportedTokens.includes("ticket_url")
    ? "Open Ticket"
    : supportedTokens.includes("magic_link_url")
    ? "Open Secure Link"
    : supportedTokens.includes("map_url")
    ? "Open Map"
    : "Open Event Page";
  const detailsRows = buildDetailsRows(supportedTokens);

  switch (blockId) {
    case "hero":
      return `
<div style="padding:24px;background:linear-gradient(135deg,#0f172a 0%,#2563eb 100%);color:#ffffff;">
  <p style="margin:0 0 8px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.78;">Featured section</p>
  <h1 style="margin:0;font-size:30px;line-height:1.2;">${eventName}</h1>
  <p style="margin:12px 0 0;font-size:15px;line-height:1.7;max-width:32rem;">Hello ${fullName}, use this hero area for the strongest message in the email.</p>
</div>`.trim();
    case "details":
      return `
<div style="padding:20px;border:1px solid #dbe4f0;border-radius:18px;background:#f8fbff;">
  <p style="margin:0 0 12px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#64748b;">Details</p>
  ${detailsRows.length > 0
    ? detailsRows.map((row) => `<p style="margin:0 0 8px;font-size:14px;"><strong>${row.label}:</strong> ${row.value}</p>`).join("\n  ")
    : `<p style="margin:0;font-size:14px;line-height:1.6;">Add important event or payment details here.</p>`}
</div>`.trim();
    case "cta":
      return `
<div style="padding:16px 0 0;">
  <a href="${primaryUrl}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;">${primaryLabel}</a>
</div>`.trim();
    case "footer":
      return `
<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.7;color:#64748b;">
  Need help? Reply to <a href="mailto:${supportEmail}" style="color:#2563eb;text-decoration:none;">${supportEmail}</a>.
</div>`.trim();
  }
}

function insertBeforeBodyClose(html: string, snippet: string) {
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${snippet}\n  </body>`);
  }
  if (/<\/html>/i.test(html)) {
    return html.replace(/<\/html>/i, `${snippet}\n</html>`);
  }
  return `${html.trim()}\n${snippet}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightTemplateTokens(value: string) {
  return escapeHtml(value).replace(
    /(\{\{[\s\S]*?\}\})/g,
    '<span class="text-fuchsia-600">$1</span>',
  );
}

function highlightHtmlAttributes(source: string) {
  let output = "";
  let cursor = 0;

  while (cursor < source.length) {
    const whitespace = source.slice(cursor).match(/^\s+/)?.[0];
    if (whitespace) {
      output += escapeHtml(whitespace);
      cursor += whitespace.length;
      continue;
    }

    const nameMatch = source.slice(cursor).match(/^([^\s=/>]+)/);
    if (!nameMatch) {
      output += highlightTemplateTokens(source.slice(cursor));
      break;
    }

    const attrName = nameMatch[1];
    const attrToneClass = attrName === "class"
      ? "text-sky-700"
      : attrName === "style"
        ? "text-orange-700"
        : "text-amber-700";

    output += `<span class="${attrToneClass}">${escapeHtml(attrName)}</span>`;
    cursor += attrName.length;

    const equalsMatch = source.slice(cursor).match(/^\s*=\s*/)?.[0];
    if (!equalsMatch) continue;

    output += escapeHtml(equalsMatch);
    cursor += equalsMatch.length;

    const valueMatch = source.slice(cursor).match(/^(".*?"|'.*?'|[^\s>]+)/)?.[0];
    if (!valueMatch) continue;

    output += `<span class="text-emerald-700">${highlightTemplateTokens(valueMatch)}</span>`;
    cursor += valueMatch.length;
  }

  return output;
}

function highlightHtmlTag(source: string) {
  if (/^<!--/.test(source)) {
    return `<span class="text-emerald-700">${escapeHtml(source)}</span>`;
  }

  if (/^<!DOCTYPE/i.test(source)) {
    return `<span class="text-violet-600">${escapeHtml(source)}</span>`;
  }

  const tagMatch = source.match(/^<(\/?)([^\s/>]+)([\s\S]*?)(\/?)>$/);
  if (!tagMatch) {
    return `<span class="text-blue-600">${escapeHtml(source)}</span>`;
  }

  const [, closingSlash, tagName, rawAttributes, selfClosingSlash] = tagMatch;
  return [
    `<span class="text-blue-600">${escapeHtml(`<${closingSlash}${tagName}`)}</span>`,
    highlightHtmlAttributes(rawAttributes),
    `<span class="text-blue-600">${escapeHtml(`${selfClosingSlash}>`)}</span>`,
  ].join("");
}

function highlightHtmlSource(source: string) {
  return source
    .split(/(<!--[\s\S]*?-->|<!DOCTYPE[\s\S]*?>|<\/?[^>]+>)/gi)
    .filter(Boolean)
    .map((segment) => (
      segment.startsWith("<")
        ? highlightHtmlTag(segment)
        : highlightTemplateTokens(segment)
    ))
    .join("");
}

function getCodeLineNumberFromOffset(source: string, offset: number) {
  return source.slice(0, Math.max(0, offset)).split("\n").length;
}

export function EmailHtmlEditor({
  value,
  renderedPreviewHtml,
  supportedTokens,
  onChange,
}: EmailHtmlEditorProps) {
  const [mode, setMode] = useState<EmailHtmlEditorMode>("rendered");
  const [quickBlocksOpen, setQuickBlocksOpen] = useState(false);
  const [visualReady, setVisualReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const codeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const codeHighlightRef = useRef<HTMLPreElement | null>(null);
  const codeLineNumbersRef = useRef<HTMLDivElement | null>(null);
  const frameCleanupRef = useRef<(() => void) | null>(null);
  const changeHandlerRef = useRef(onChange);
  const latestValueRef = useRef(value);
  const lastVisualSelectionRef = useRef("");
  const pendingCodeSelectionRef = useRef<string | null>(null);
  const [codeActiveLine, setCodeActiveLine] = useState(1);
  const [codeScrollTop, setCodeScrollTop] = useState(0);
  const [codeScrollLeft, setCodeScrollLeft] = useState(0);

  useEffect(() => {
    changeHandlerRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (mode !== "code") return;

    const textarea = codeTextareaRef.current;
    const selectionText = pendingCodeSelectionRef.current?.trim();
    pendingCodeSelectionRef.current = null;

    if (!textarea || !selectionText) return;

    requestAnimationFrame(() => {
      const exactIndex = value.indexOf(selectionText);
      if (exactIndex >= 0) {
        textarea.focus();
        textarea.setSelectionRange(exactIndex, exactIndex + selectionText.length);
        setCodeActiveLine(getCodeLineNumberFromOffset(value, exactIndex));
        return;
      }

      const regex = new RegExp(escapeRegExp(selectionText).replace(/\s+/g, "\\s+"), "i");
      const match = regex.exec(value);
      if (!match || match.index == null) return;

      textarea.focus();
      textarea.setSelectionRange(match.index, match.index + match[0].length);
      setCodeActiveLine(getCodeLineNumberFromOffset(value, match.index));
    });
  }, [mode, value]);

  useEffect(() => {
    if (mode !== "code") return;
    const textarea = codeTextareaRef.current;
    if (!textarea) return;
    setCodeActiveLine(getCodeLineNumberFromOffset(value, textarea.selectionStart || 0));
  }, [mode, value]);

  useEffect(() => {
    if (mode !== "visual") {
      setVisualReady(false);
      frameCleanupRef.current?.();
      frameCleanupRef.current = null;
      return;
    }

    const iframe = iframeRef.current;
    if (!iframe) return;

    let detached = false;

    const syncHtmlFromDocument = (doc: Document) => {
      const nextHtml = serializeDocumentWithDoctype(doc);
      latestValueRef.current = nextHtml;
      changeHandlerRef.current(nextHtml);
    };

    const attachDocumentListeners = () => {
      const doc = iframe.contentDocument;
      if (!doc || detached) return;

      ensureVisualEditorDocument(doc);
      frameCleanupRef.current?.();

      const handleInput = () => {
        syncHtmlFromDocument(doc);
      };

      const handleSelectionChange = () => {
        const selectedText = doc.getSelection?.()?.toString().replace(/\s+/g, " ").trim() || "";
        if (selectedText) {
          lastVisualSelectionRef.current = selectedText;
        }
      };

      doc.addEventListener("input", handleInput);
      doc.addEventListener("keyup", handleInput);
      doc.addEventListener("selectionchange", handleSelectionChange);
      frameCleanupRef.current = () => {
        doc.removeEventListener("input", handleInput);
        doc.removeEventListener("keyup", handleInput);
        doc.removeEventListener("selectionchange", handleSelectionChange);
      };
      setVisualReady(true);
    };

    const handleLoad = () => {
      if (detached) return;
      attachDocumentListeners();
    };

    iframe.addEventListener("load", handleLoad);

    const currentDoc = iframe.contentDocument;
    const currentHtml = currentDoc?.documentElement ? serializeDocumentWithDoctype(currentDoc) : "";
    if (!currentDoc?.documentElement || currentHtml !== value) {
      setVisualReady(false);
      iframe.srcdoc = value;
    } else {
      attachDocumentListeners();
    }

    return () => {
      detached = true;
      iframe.removeEventListener("load", handleLoad);
      frameCleanupRef.current?.();
      frameCleanupRef.current = null;
    };
  }, [mode, value]);

  const runVisualCommand = (
    command: "bold" | "italic" | "underline" | "insertUnorderedList" | "insertOrderedList" | "removeFormat" | "createLink" | "formatBlock",
    valueArg?: string,
  ) => {
    if (mode !== "visual" || !visualReady) return;

    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;

    ensureVisualEditorDocument(doc);
    doc.body?.focus();

    if (command === "createLink") {
      const nextUrl = window.prompt("Link URL", "https://");
      if (!nextUrl?.trim()) return;
      doc.execCommand(command, false, nextUrl.trim());
    } else {
      doc.execCommand(command, false, valueArg ?? null);
    }

    const nextHtml = serializeDocumentWithDoctype(doc);
    latestValueRef.current = nextHtml;
    onChange(nextHtml);
  };

  const insertQuickBlock = (blockId: EmailQuickBlockId) => {
    const snippet = buildQuickBlockMarkup(blockId, supportedTokens);

    if (mode === "visual" && visualReady) {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      ensureVisualEditorDocument(doc);
      doc.body?.focus();
      doc.execCommand("insertHTML", false, snippet);
      const nextHtml = serializeDocumentWithDoctype(doc);
      latestValueRef.current = nextHtml;
      onChange(nextHtml);
      return;
    }

    const nextHtml = insertBeforeBodyClose(value, snippet);
    latestValueRef.current = nextHtml;
    onChange(nextHtml);
  };

  const formattingButtons = [
    { label: "B", title: "Bold", action: () => runVisualCommand("bold") },
    { label: "I", title: "Italic", action: () => runVisualCommand("italic") },
    { label: "U", title: "Underline", action: () => runVisualCommand("underline") },
    { label: "H1", title: "Heading 1", action: () => runVisualCommand("formatBlock", "<h1>") },
    { label: "H2", title: "Heading 2", action: () => runVisualCommand("formatBlock", "<h2>") },
    { label: "P", title: "Paragraph", action: () => runVisualCommand("formatBlock", "<p>") },
    { label: "UL", title: "Bullet List", action: () => runVisualCommand("insertUnorderedList") },
    { label: "OL", title: "Numbered List", action: () => runVisualCommand("insertOrderedList") },
    { label: "Link", title: "Create Link", action: () => runVisualCommand("createLink") },
    { label: "Clear", title: "Remove Formatting", action: () => runVisualCommand("removeFormat") },
  ] as const;

  const quickBlocks = [
    { id: "hero", label: "Hero" },
    { id: "details", label: "Details" },
    { id: "cta", label: "CTA Button" },
    { id: "footer", label: "Footer" },
  ] as const satisfies ReadonlyArray<{ id: EmailQuickBlockId; label: string }>;
  const highlightedSourceMarkup = highlightHtmlSource(value);
  const lineNumbers = Array.from({ length: Math.max(1, value.split("\n").length) }, (_, index) => index + 1);
  const codeActiveLineTop = (codeActiveLine - 1) * CODE_EDITOR_LINE_HEIGHT - codeScrollTop;
  const codeLineHighlightVisible = codeActiveLineTop + CODE_EDITOR_LINE_HEIGHT > 0 && codeActiveLineTop < 720;
  const updateCodeCursorState = (textarea: HTMLTextAreaElement) => {
    setCodeActiveLine(getCodeLineNumberFromOffset(value, textarea.selectionStart || 0));
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-900">HTML Composer</p>
          <EmailEditorHelpBubble label="Open note for HTML Composer">
            <p>Switch between source editing, inline visual editing, and final rendered preview in one place.</p>
            <p className="mt-2">Visual Edit writes changes back into the HTML body. Rendered Preview shows sample event data applied.</p>
          </EmailEditorHelpBubble>
        </div>
        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
          {([
            { id: "rendered", label: "Rendered Preview" },
            { id: "visual", label: "Visual Edit" },
            { id: "code", label: "HTML Body" },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (tab.id === "code" && mode === "visual") {
                  pendingCodeSelectionRef.current = lastVisualSelectionRef.current || null;
                }
                setMode(tab.id);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                mode === tab.id
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {mode !== "rendered" && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Quick Blocks</p>
                <EmailEditorHelpBubble label="Open note for Quick Blocks">
                  <p>Insert reusable sections like a hero, details card, CTA, or footer without writing the full markup by hand.</p>
                  <p className="mt-2">In Visual Edit blocks insert at the cursor. In HTML Body they append before the closing body tag.</p>
                </EmailEditorHelpBubble>
              </div>
              <button
                type="button"
                onClick={() => setQuickBlocksOpen((current) => !current)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-blue-200 hover:text-blue-600"
              >
                {quickBlocksOpen ? "Hide Blocks" : "Show Blocks"}
              </button>
            </div>
            {quickBlocksOpen && (
              <div className="mt-3 flex flex-wrap gap-2">
                {quickBlocks.map((block) => (
                  <button
                    key={block.id}
                    type="button"
                    onClick={() => insertQuickBlock(block.id)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-blue-200 hover:text-blue-600"
                  >
                    {block.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === "visual" && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Formatting Toolbar</p>
                <EmailEditorHelpBubble label="Open note for Formatting Toolbar">
                  <p>Select text inside Visual Edit, then apply headings, lists, links, or inline formatting.</p>
                </EmailEditorHelpBubble>
              </div>
              <div className="flex flex-wrap gap-2">
                {formattingButtons.map((button) => (
                  <button
                    key={button.label}
                    type="button"
                    onClick={button.action}
                    disabled={!visualReady}
                    title={button.title}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-blue-200 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {button.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4">
        {mode === "code" && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">HTML Body</p>
              <span className="text-[11px] text-slate-500">Syntax colors + line focus enabled.</span>
            </div>
            <div className="relative h-[720px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              <div className="absolute inset-y-0 left-0 w-14 border-r border-slate-200 bg-white/75" />
              {codeLineHighlightVisible && (
                <>
                  <div
                    className="pointer-events-none absolute left-0 z-0 w-14 bg-blue-100/80"
                    style={{
                      top: `${codeActiveLineTop}px`,
                      height: `${CODE_EDITOR_LINE_HEIGHT}px`,
                    }}
                  />
                  <div
                    className="pointer-events-none absolute left-14 right-0 z-0 bg-blue-100/60"
                    style={{
                      top: `${codeActiveLineTop}px`,
                      height: `${CODE_EDITOR_LINE_HEIGHT}px`,
                    }}
                  />
                </>
              )}
              <div className="absolute inset-y-0 left-0 z-10 w-14 overflow-hidden">
                <div
                  ref={codeLineNumbersRef}
                  aria-hidden="true"
                  className="pointer-events-none px-2 py-3 font-mono text-[11px] leading-6 text-right text-slate-400"
                  style={{ transform: `translateY(${-codeScrollTop}px)` }}
                >
                  {lineNumbers.map((lineNumber) => (
                    <div
                      key={lineNumber}
                      className={lineNumber === codeActiveLine ? "font-semibold text-blue-700" : ""}
                    >
                      {lineNumber}
                    </div>
                  ))}
                </div>
              </div>
              <div className="absolute inset-y-0 left-14 right-0 overflow-hidden">
                <pre
                  ref={codeHighlightRef}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 overflow-hidden px-4 py-3 font-mono text-[12px] leading-6 whitespace-pre text-slate-800"
                >
                  <code
                    className="block min-w-max"
                    style={{ transform: `translate(${-codeScrollLeft}px, ${-codeScrollTop}px)` }}
                    dangerouslySetInnerHTML={{ __html: `${highlightedSourceMarkup || "<br />"}\n` }}
                  />
                </pre>
              </div>
              <textarea
                ref={codeTextareaRef}
                value={value}
                onChange={(event) => {
                  onChange(event.target.value);
                  updateCodeCursorState(event.currentTarget);
                }}
                onClick={(event) => updateCodeCursorState(event.currentTarget)}
                onKeyUp={(event) => updateCodeCursorState(event.currentTarget)}
                onSelect={(event) => updateCodeCursorState(event.currentTarget)}
                onScroll={(event) => {
                  const nextTarget = event.currentTarget;
                  setCodeScrollTop(nextTarget.scrollTop);
                  setCodeScrollLeft(nextTarget.scrollLeft);
                }}
                wrap="off"
                spellCheck={false}
                className="absolute inset-y-0 left-14 right-0 z-20 h-full w-auto resize-none overflow-auto bg-transparent px-4 py-3 font-mono text-[12px] leading-6 text-transparent caret-slate-900 outline-none focus:ring-2 focus:ring-blue-500"
                style={{ WebkitTextFillColor: "transparent" }}
              />
            </div>
          </div>
        )}

        {mode === "visual" && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Visual Edit</p>
              <span className="text-[11px] text-slate-500">
                {visualReady ? "Select text to jump into HTML Body." : "Preparing visual editor..."}
              </span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              <iframe
                ref={iframeRef}
                title="Editable email HTML preview"
                className="h-[720px] w-full border-0 bg-white"
              />
            </div>
          </div>
        )}

        {mode === "rendered" && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Rendered Preview</p>
              <span className="text-[11px] text-slate-500">Sample data applied.</span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              <iframe
                title="Rendered email preview"
                srcDoc={renderedPreviewHtml}
                className="h-[720px] w-full border-0 bg-white"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
