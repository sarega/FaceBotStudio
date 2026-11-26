import { downloadFilename } from "../../../lib/reportFilenames";
import { useState } from "react";
import { FileText } from "lucide-react";

export function LogisticsPdfButton({ path, language, filename, ready, dirty, apiFetch }: {
  path: string;
  language: "th" | "en";
  filename: string;
  ready: boolean;
  dirty: boolean;
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const th = language === "th";
  const hint = dirty ? (th ? "บันทึกแผนก่อนดาวน์โหลด PDF" : "Save the plan before downloading the PDF.") : undefined;

  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      const response = await apiFetch(`${path}/report?language=${language}`);
      if (!response.ok || !response.headers.get("Content-Type")?.startsWith("application/pdf")) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadFilename(response.headers.get("Content-Disposition"),filename);
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button type="button" className="registration-admin-control" disabled={!ready || dirty || busy}
      title={hint} onClick={() => void download()}>
      <FileText className="h-4 w-4" aria-hidden="true" />
      {busy ? (th ? "กำลังสร้าง PDF…" : "Preparing PDF…") : (th ? "ดาวน์โหลด PDF" : "Download PDF")}
    </button>
    {failed && <span role="alert" className="text-xs text-red-600">{th ? "ดาวน์โหลด PDF ไม่สำเร็จ" : "Could not download the PDF."}</span>}
  </>;
}
