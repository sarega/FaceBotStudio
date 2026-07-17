import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
} from "lucide-react";

import { renderEventDescriptionHtml } from "../lib/eventDescriptionHtml";

type EventDescriptionHtmlEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onUploadImage?: (file: File) => Promise<string | null>;
};

type ToolbarButtonProps = {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
};

function ToolbarButton({ label, onClick, children, disabled }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}

export function EventDescriptionHtmlEditor({ value, onChange, onUploadImage }: EventDescriptionHtmlEditorProps) {
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [uploading, setUploading] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const lastValueRef = useRef(value);

  useEffect(() => {
    if (mode !== "visual" || !editorRef.current || document.activeElement === editorRef.current) return;
    if (lastValueRef.current === value && editorRef.current.innerHTML) return;
    editorRef.current.innerHTML = renderEventDescriptionHtml(value);
    lastValueRef.current = value;
  }, [mode, value]);

  const syncVisualValue = () => {
    const next = editorRef.current?.innerHTML || "";
    lastValueRef.current = next;
    onChange(next);
  };

  const runCommand = (command: string, commandValue?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    syncVisualValue();
  };

  const insertLink = () => {
    const href = window.prompt("Paste the link URL");
    if (!href?.trim()) return;
    runCommand("createLink", href.trim());
  };

  const handleImageFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.currentTarget.value = "";
    if (!file || !onUploadImage) return;
    setUploading(true);
    try {
      const imageUrl = await onUploadImage(file);
      if (imageUrl) {
        runCommand("insertImage", imageUrl);
      }
    } finally {
      setUploading(false);
    }
  };

  const switchMode = (nextMode: "visual" | "html") => {
    if (nextMode === mode) return;
    if (mode === "visual") syncVisualValue();
    setMode(nextMode);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
        <div>
          <p className="text-xs font-semibold text-slate-800">Event story</p>
          <p className="mt-0.5 text-[11px] text-slate-500">Format the page as attendees will read it.</p>
        </div>
        <div className="flex rounded-xl border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => switchMode("visual")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${mode === "visual" ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            Visual
          </button>
          <button
            type="button"
            onClick={() => switchMode("html")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${mode === "html" ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            <Code2 className="h-3.5 w-3.5" /> HTML
          </button>
        </div>
      </div>

      {mode === "visual" ? (
        <>
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-3 py-2">
            <select
              defaultValue="p"
              onChange={(event) => runCommand("formatBlock", event.target.value)}
              className="mr-1 h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Text style"
            >
              <option value="p">Paragraph</option>
              <option value="h2">Heading</option>
              <option value="h3">Subheading</option>
              <option value="blockquote">Quote</option>
            </select>
            <ToolbarButton label="Bold" onClick={() => runCommand("bold")}><Bold className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label="Italic" onClick={() => runCommand("italic")}><Italic className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label="Underline" onClick={() => runCommand("underline")}><Underline className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label="Strikethrough" onClick={() => runCommand("strikeThrough")}><Strikethrough className="h-4 w-4" /></ToolbarButton>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <label className="relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100" title="Text color">
              <span className="text-sm font-bold">A</span>
              <span className="absolute bottom-1 h-0.5 w-4 rounded-full bg-amber-500" />
              <input
                type="color"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(event) => runCommand("foreColor", event.target.value)}
                aria-label="Text color"
              />
            </label>
            <ToolbarButton label="Bulleted list" onClick={() => runCommand("insertUnorderedList")}><List className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label="Numbered list" onClick={() => runCommand("insertOrderedList")}><ListOrdered className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label="Quote" onClick={() => runCommand("formatBlock", "blockquote")}><Quote className="h-4 w-4" /></ToolbarButton>
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <ToolbarButton label="Align left" onClick={() => runCommand("justifyLeft")}><AlignLeft className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label="Align center" onClick={() => runCommand("justifyCenter")}><AlignCenter className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label="Align right" onClick={() => runCommand("justifyRight")}><AlignRight className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label="Add link" onClick={insertLink}><Link2 className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label={uploading ? "Uploading image" : "Add image"} disabled={!onUploadImage || uploading} onClick={() => imageInputRef.current?.click()}>
              <ImagePlus className={`h-4 w-4 ${uploading ? "animate-pulse" : ""}`} />
            </ToolbarButton>
            <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => void handleImageFile(event)} />
            <span className="mx-1 h-5 w-px bg-slate-200" />
            <ToolbarButton label="Undo" onClick={() => runCommand("undo")}><Undo2 className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label="Redo" onClick={() => runCommand("redo")}><Redo2 className="h-4 w-4" /></ToolbarButton>
            <ToolbarButton label="Clear formatting" onClick={() => runCommand("removeFormat")}><RemoveFormatting className="h-4 w-4" /></ToolbarButton>
          </div>

          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={syncVisualValue}
            className="event-description-content rich-event-editor min-h-[24rem] bg-white p-5 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 sm:p-7"
            data-placeholder="Tell attendees what makes this event special…"
          />
        </>
      ) : (
        <textarea
          value={value}
          onChange={(event) => {
            lastValueRef.current = event.target.value;
            onChange(event.target.value);
          }}
          rows={16}
          className="min-h-[24rem] w-full resize-y border-0 bg-slate-950 p-5 font-mono text-sm leading-6 text-slate-100 outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
          placeholder="<h2>Event heading</h2>\n<p>Event details…</p>"
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
        <span>Images: PNG, JPG, or WebP · maximum 4 MB each</span>
        <span>{value.length.toLocaleString()} characters</span>
      </div>
    </div>
  );
}
