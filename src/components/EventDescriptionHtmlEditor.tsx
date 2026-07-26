import { useMemo, useState } from "react";
import FroalaEditorComponent from "react-froala-wysiwyg";

import "froala-editor/css/froala_editor.pkgd.min.css";
import "froala-editor/css/froala_style.min.css";
import "froala-editor/js/plugins.pkgd.min.js";

type EventDescriptionHtmlEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onUploadImage?: (file: File) => Promise<string | null>;
};

type FroalaInstance = {
  image: { insert: (url: string, replace?: boolean, data?: unknown, image?: unknown) => void; get: () => unknown };
  popups: { hide: (name: string) => void };
  events: { trigger: (name: string, args?: unknown[]) => void };
};

const FONT_FAMILIES = {
  "Sarabun": "Sarabun, sans-serif",
  "Noto Sans Thai": "Noto Sans Thai, sans-serif",
  "Tahoma": "Tahoma, sans-serif",
  "Arial": "Arial, sans-serif",
  "Georgia": "Georgia, serif",
  "Times New Roman": "Times New Roman, serif",
};

const FONT_SIZES = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "30", "36", "48", "60", "72", "96", "custom"];

export function EventDescriptionHtmlEditor({ value, onChange, onUploadImage }: EventDescriptionHtmlEditorProps) {
  const [uploading, setUploading] = useState(false);

  const config = useMemo(() => ({
    attribution: false,
    charCounterCount: true,
    charCounterMax: 50_000,
    fontFamily: FONT_FAMILIES,
    fontFamilySelection: true,
    fontSize: FONT_SIZES,
    fontSizeCustomMin: 8,
    fontSizeCustomMax: 96,
    fontSizeSelection: true,
    heightMin: 360,
    heightMax: 760,
    imageAllowedTypes: ["jpeg", "jpg", "png", "webp", "gif"],
    imageInsertButtons: ["imageBack", "|", "imageUpload", "imageByURL"],
    imageMaxSize: 4 * 1024 * 1024,
    paragraphFormat: {
      N: "Normal",
      H1: "Heading 1",
      H2: "Heading 2",
      H3: "Heading 3",
      H4: "Heading 4",
      PRE: "Code",
    },
    tableInsertMaxSize: 12,
    toolbarButtons: {
      moreText: {
        buttons: ["bold", "italic", "underline", "strikeThrough", "fontFamily", "fontSize", "textColor", "backgroundColor", "clearFormatting"],
        buttonsVisible: 9,
      },
      moreParagraph: {
        buttons: ["paragraphFormat", "alignLeft", "alignCenter", "alignRight", "alignJustify", "formatUL", "formatOLSimple", "outdent", "indent", "quote", "insertHR", "insertLink", "insertImage", "insertTable", "emoticons", "undo", "redo", "html"],
        buttonsVisible: 18,
      },
    },
    events: {
      "image.beforeUpload": function (this: FroalaInstance, files: File[]) {
        const file = files?.[0];
        if (!file || !onUploadImage) return false;
        const editor = this;
        setUploading(true);
        void onUploadImage(file)
          .then((url) => {
            if (url) {
              editor.image.insert(url, false, undefined, editor.image.get());
            }
          })
          .catch(() => editor.events.trigger("image.error", [{ code: 3, message: "Could not upload image" }]))
          .finally(() => {
            setUploading(false);
            editor.popups.hide("image.insert");
          });
        return false;
      },
    },
  }), [onUploadImage]);

  return (
    <div className="froala-event-editor overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
        <div>
          <p className="text-xs font-semibold text-slate-800">Event story</p>
          <p className="mt-0.5 text-[11px] text-slate-500">Use the toolbar or HTML view. Pasted formatting, tables, and image sizes are preserved.</p>
        </div>
        {uploading ? <span className="text-xs font-medium text-blue-600">Uploading image…</span> : null}
      </div>
      <FroalaEditorComponent
        tag="textarea"
        model={value}
        config={config}
        onModelChange={onChange as never}
      />
    </div>
  );
}
