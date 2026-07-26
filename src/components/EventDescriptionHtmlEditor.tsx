import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  AlignCenter, AlignLeft, AlignRight, Bold, Code2, ImagePlus, IndentDecrease, IndentIncrease,
  Italic, Link2, List, ListOrdered, Minus, Quote, Redo2, RemoveFormatting, Smile,
  Strikethrough, Table2, Underline, Undo2,
} from "lucide-react";

type EventDescriptionHtmlEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onUploadImage?: (file: File) => Promise<string | null>;
};

type ToolbarButtonProps = { label: string; onClick: () => void; children: ReactNode; disabled?: boolean };

const EMOJIS = ["😀", "😊", "🎉", "✨", "⭐", "❤️", "👍", "📍", "📅", "🎤", "🎭", "🎶", "✅", "⚡", "🌿", "🙏"];

function ToolbarButton({ label, onClick, children, disabled }: ToolbarButtonProps) {
  return <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onClick} disabled={disabled}
    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
    title={label} aria-label={label}>{children}</button>;
}

export function EventDescriptionHtmlEditor({ value, onChange, onUploadImage }: EventDescriptionHtmlEditorProps) {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [uploading, setUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const lastValueRef = useRef(value);

  useEffect(() => {
    if (mode !== "visual" || !editorRef.current || document.activeElement === editorRef.current) return;
    if (lastValueRef.current === value && editorRef.current.innerHTML) return;
    editorRef.current.innerHTML = value;
    lastValueRef.current = value;
  }, [mode, value]);

  const sync = () => {
    const next = editorRef.current?.innerHTML || "";
    lastValueRef.current = next;
    onChange(next);
  };

  const rememberSelection = () => {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !editorRef.current?.contains(selection.anchorNode)) return;
    selectionRef.current = selection.getRangeAt(0).cloneRange();
  };

  const restoreSelection = () => {
    editorRef.current?.focus();
    const selection = window.getSelection();
    if (!selection || !selectionRef.current) return;
    selection.removeAllRanges();
    selection.addRange(selectionRef.current);
  };

  const command = (name: string, commandValue?: string) => {
    restoreSelection();
    document.execCommand(name, false, commandValue);
    rememberSelection();
    sync();
  };

  const applyFontSize = (size: string) => {
    restoreSelection();
    document.execCommand("fontSize", false, "7");
    editorRef.current?.querySelectorAll('font[size="7"]').forEach((node) => {
      (node as HTMLElement).style.fontSize = `${size}px`;
      node.removeAttribute("size");
    });
    sync();
  };

  const insertLink = () => {
    const href = window.prompt("Paste the link URL");
    if (href?.trim()) command("createLink", href.trim());
  };

  const insertTable = () => {
    const rows = Math.min(12, Math.max(1, Number.parseInt(window.prompt("Rows", "3") || "", 10) || 3));
    const cols = Math.min(8, Math.max(1, Number.parseInt(window.prompt("Columns", "3") || "", 10) || 3));
    const body = Array.from({ length: rows }, (_, row) => `<tr>${Array.from({ length: cols }, (_, col) => row === 0 ? `<th>Heading ${col + 1}</th>` : "<td>Cell</td>").join("")}</tr>`).join("");
    command("insertHTML", `<table><tbody>${body}</tbody></table><p><br></p>`);
  };

  const insertEmoji = (emoji: string) => {
    setEmojiOpen(false);
    command("insertText", emoji);
  };

  const handleImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file || !onUploadImage) return;
    setUploading(true);
    try {
      const url = await onUploadImage(file);
      if (url) command("insertHTML", `<img src="${url.replace(/"/g, "&quot;")}" alt="Event content image" style="max-width: 100%;" />`);
    } finally {
      setUploading(false);
    }
  };

  const resizeSelectedImage = (width: string) => {
    if (!selectedImage) return;
    selectedImage.style.width = width;
    selectedImage.style.height = "auto";
    selectedImage.removeAttribute("width");
    selectedImage.removeAttribute("height");
    sync();
  };

  const setCustomImageWidth = () => {
    if (!selectedImage) return;
    const current = selectedImage.style.width || "100%";
    const width = window.prompt("Image width (for example: 420px or 70%)", current);
    if (!width?.trim() || !/^(?:\d+(?:\.\d+)?(?:px|%))$/i.test(width.trim())) return;
    resizeSelectedImage(width.trim());
  };

  const switchMode = (next: "visual" | "html") => {
    if (next === mode) return;
    if (mode === "visual") sync();
    setEmojiOpen(false);
    setMode(next);
  };

  return <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
      <div><p className="text-xs font-semibold text-slate-800">Event story</p><p className="mt-0.5 text-[11px] text-slate-500">Format freely, or paste and edit HTML directly.</p></div>
      <div className="flex rounded-xl border border-slate-200 bg-white p-1">
        <button type="button" onClick={() => switchMode("visual")} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === "visual" ? "bg-blue-600 text-white" : "text-slate-500"}`}>Visual</button>
        <button type="button" onClick={() => switchMode("html")} className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === "html" ? "bg-blue-600 text-white" : "text-slate-500"}`}><Code2 className="h-3.5 w-3.5" /> HTML</button>
      </div>
    </div>
    {mode === "visual" ? <>
      <div className="relative flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-3 py-2">
        <select defaultValue="p" onChange={(event) => command("formatBlock", event.target.value)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600" aria-label="Paragraph style"><option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="blockquote">Quote</option></select>
        <select defaultValue="16" onChange={(event) => applyFontSize(event.target.value)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600" aria-label="Font size"><option value="8">8 px</option><option value="9">9 px</option><option value="10">10 px</option><option value="11">11 px</option><option value="12">12 px</option><option value="14">14 px</option><option value="16">16 px</option><option value="18">18 px</option><option value="20">20 px</option><option value="24">24 px</option><option value="30">30 px</option><option value="36">36 px</option></select>
        <select defaultValue="Sarabun" onChange={(event) => command("fontName", event.target.value)} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600" aria-label="Font family"><option>Sarabun</option><option>Noto Sans Thai</option><option>Tahoma</option><option>Arial</option><option>Georgia</option><option>Times New Roman</option></select>
        <ToolbarButton label="Bold" onClick={() => command("bold")}><Bold className="h-4 w-4" /></ToolbarButton><ToolbarButton label="Italic" onClick={() => command("italic")}><Italic className="h-4 w-4" /></ToolbarButton><ToolbarButton label="Underline" onClick={() => command("underline")}><Underline className="h-4 w-4" /></ToolbarButton><ToolbarButton label="Strikethrough" onClick={() => command("strikeThrough")}><Strikethrough className="h-4 w-4" /></ToolbarButton>
        <label className="relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100" title="Text color"><span className="font-bold">A</span><input type="color" className="absolute inset-0 opacity-0" onChange={(event) => command("foreColor", event.target.value)} /></label>
        <label className="relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100" title="Background color"><span className="h-4 w-4 rounded border border-slate-400 bg-amber-200" /><input type="color" defaultValue="#fef3c7" className="absolute inset-0 opacity-0" onChange={(event) => command("hiliteColor", event.target.value)} /></label>
        <ToolbarButton label="Bulleted list" onClick={() => command("insertUnorderedList")}><List className="h-4 w-4" /></ToolbarButton><ToolbarButton label="Numbered list" onClick={() => command("insertOrderedList")}><ListOrdered className="h-4 w-4" /></ToolbarButton><ToolbarButton label="Indent less" onClick={() => command("outdent")}><IndentDecrease className="h-4 w-4" /></ToolbarButton><ToolbarButton label="Indent more" onClick={() => command("indent")}><IndentIncrease className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label="Align left" onClick={() => command("justifyLeft")}><AlignLeft className="h-4 w-4" /></ToolbarButton><ToolbarButton label="Align center" onClick={() => command("justifyCenter")}><AlignCenter className="h-4 w-4" /></ToolbarButton><ToolbarButton label="Align right" onClick={() => command("justifyRight")}><AlignRight className="h-4 w-4" /></ToolbarButton><ToolbarButton label="Quote" onClick={() => command("formatBlock", "blockquote")}><Quote className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label="Horizontal line" onClick={() => command("insertHorizontalRule")}><Minus className="h-4 w-4" /></ToolbarButton><ToolbarButton label="Add link" onClick={insertLink}><Link2 className="h-4 w-4" /></ToolbarButton><ToolbarButton label="Insert table" onClick={insertTable}><Table2 className="h-4 w-4" /></ToolbarButton><ToolbarButton label={uploading ? "Uploading image" : "Add image"} disabled={!onUploadImage || uploading} onClick={() => imageInputRef.current?.click()}><ImagePlus className={`h-4 w-4 ${uploading ? "animate-pulse" : ""}`} /></ToolbarButton>
        <ToolbarButton label="Emoji" onClick={() => { rememberSelection(); setEmojiOpen((open) => !open); }}><Smile className="h-4 w-4" /></ToolbarButton><ToolbarButton label="Undo" onClick={() => command("undo")}><Undo2 className="h-4 w-4" /></ToolbarButton><ToolbarButton label="Redo" onClick={() => command("redo")}><Redo2 className="h-4 w-4" /></ToolbarButton><ToolbarButton label="Clear formatting" onClick={() => command("removeFormat")}><RemoveFormatting className="h-4 w-4" /></ToolbarButton>
        <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(event) => void handleImage(event)} />
        {emojiOpen && <div className="absolute right-3 top-full z-20 mt-1 grid grid-cols-8 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">{EMOJIS.map((emoji) => <button key={emoji} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => insertEmoji(emoji)} className="h-8 w-8 rounded-lg text-lg hover:bg-slate-100">{emoji}</button>)}</div>}
      </div>
      {selectedImage && <div className="flex flex-wrap items-center gap-1 border-b border-blue-100 bg-blue-50 px-3 py-2 text-xs text-slate-600">
        <span className="mr-1 font-semibold text-blue-700">Image size</span>
        {["25%", "50%", "75%", "100%"].map((width) => <button key={width} type="button" onClick={() => resizeSelectedImage(width)} className="rounded-md border border-blue-200 bg-white px-2 py-1 font-semibold hover:border-blue-400 hover:text-blue-700">{width}</button>)}
        <button type="button" onClick={setCustomImageWidth} className="rounded-md border border-blue-200 bg-white px-2 py-1 font-semibold hover:border-blue-400 hover:text-blue-700">Custom…</button>
        <button type="button" onClick={() => setSelectedImage(null)} className="ml-auto text-slate-500 hover:text-slate-800">Done</button>
      </div>}
      <div ref={editorRef} contentEditable suppressContentEditableWarning onInput={sync} onKeyUp={rememberSelection} onMouseUp={rememberSelection} onClick={(event) => setSelectedImage(event.target instanceof HTMLImageElement ? event.target : null)} className="event-description-content rich-event-editor min-h-[24rem] bg-white p-5 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 sm:p-7" data-placeholder="Tell attendees what makes this event special…" />
    </> : <textarea value={value} onChange={(event) => { lastValueRef.current = event.target.value; onChange(event.target.value); }} rows={16} className="min-h-[24rem] w-full resize-y border-0 bg-slate-950 p-5 font-mono text-sm leading-6 text-slate-100 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500" placeholder="<h2>Event heading</h2>\n<p>Event details…</p>" />}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500"><span>Images: PNG, JPG, WebP, or GIF · maximum 4 MB each</span><span>{value.length.toLocaleString()} characters</span></div>
  </div>;
}
