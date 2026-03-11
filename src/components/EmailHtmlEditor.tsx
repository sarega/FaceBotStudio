import { useEffect, useRef, useState } from "react";

type EmailHtmlEditorMode = "code" | "visual" | "rendered";
type EmailQuickBlockId = "hero" | "details" | "cta" | "footer";

type EmailHtmlEditorProps = {
  value: string;
  renderedPreviewHtml: string;
  supportedTokens: string[];
  onChange: (value: string) => void;
};

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

export function EmailHtmlEditor({
  value,
  renderedPreviewHtml,
  supportedTokens,
  onChange,
}: EmailHtmlEditorProps) {
  const [mode, setMode] = useState<EmailHtmlEditorMode>("code");
  const [visualReady, setVisualReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const frameCleanupRef = useRef<(() => void) | null>(null);
  const changeHandlerRef = useRef(onChange);
  const latestValueRef = useRef(value);

  useEffect(() => {
    changeHandlerRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

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

      doc.addEventListener("input", handleInput);
      doc.addEventListener("keyup", handleInput);
      frameCleanupRef.current = () => {
        doc.removeEventListener("input", handleInput);
        doc.removeEventListener("keyup", handleInput);
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

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">HTML Composer</p>
          <p className="mt-1 text-xs text-slate-500">
            Switch between source, inline visual editing, and final preview without leaving the same editor surface.
          </p>
        </div>
        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
          {([
            { id: "code", label: "HTML Body" },
            { id: "visual", label: "Visual Edit" },
            { id: "rendered", label: "Rendered Preview" },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMode(tab.id)}
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
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Quick Blocks</p>
              <p className="mt-1 text-xs text-slate-500">
                Insert reusable email sections. In visual mode they appear at the current cursor position; in source mode they append into the HTML body.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
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
          </div>
        </div>

        {mode === "visual" && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Formatting Toolbar</p>
                <p className="mt-1 text-xs text-slate-500">
                  Highlight text inside the editable preview, then apply formatting or structure inline.
                </p>
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
            <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500 mb-1">HTML Body</label>
            <textarea
              value={value}
              onChange={(event) => onChange(event.target.value)}
              rows={20}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {mode === "visual" && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Visual Edit</p>
              <span className="text-[11px] text-slate-500">
                {visualReady ? "Click inside the email and edit directly." : "Preparing editable preview..."}
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
              <span className="text-[11px] text-slate-500">Sample event data applied for final output preview.</span>
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
