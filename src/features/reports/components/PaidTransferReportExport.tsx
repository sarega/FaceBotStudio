import { downloadFilename } from "../../../lib/reportFilenames";
import { useState } from "react";
import type { AppLanguage } from "../../../lib/i18n";

export function PaidTransferReportExport({ eventId, apiFetch, language }: {
  eventId: string;
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  language: AppLanguage;
}) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const prefix = `/api/events/${encodeURIComponent(eventId)}/paid-registration`;
  const [reportDate, setReportDate] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date()));
  const [reportScope, setReportScope] = useState("day");
  const [reportEnd, setReportEnd] = useState(reportDate);
  const reportReady = reportScope === "all" || (!!reportDate &&
    (reportScope === "day" || (!!reportEnd && reportEnd >= reportDate)));
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");

  async function downloadReport() {
    if (!reportReady || reportBusy) return;
    setReportBusy(true);
    setReportError("");
    try {
      const params = new URLSearchParams(reportScope === "all" ? { all: "1" } :
        reportScope === "range" ? { from: reportDate, to: reportEnd } : { date: reportDate });
      const response = await apiFetch(`${prefix}/daily-transfer-report?${params}`);
      if (!response.ok) throw new Error(t("สร้างรายงานไม่สำเร็จ กรุณาลองอีกครั้ง", "Could not generate the report. Try again."));
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadFilename(response.headers.get("Content-Disposition"),"Payment-Transfer-Verification.pdf");
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : t("สร้างรายงานไม่สำเร็จ", "Could not generate the report."));
    } finally {
      setReportBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-2">
        <label className="text-sm font-medium text-slate-900">{t("ช่วงรายงาน (เวลาไทย)", "Report period (Thailand time)")}
          <select className="mt-1 block rounded-lg border border-slate-200 bg-white px-2 py-1.5"
            value={reportScope} onChange={(event) => setReportScope(event.target.value)}>
            <option value="day">{t("วันเดียว", "Single day")}</option>
            <option value="range">{t("ช่วงวันที่", "Date range")}</option>
            <option value="all">{t("ทั้งอีเวนต์", "Entire event")}</option>
          </select>
        </label>
        {reportScope !== "all" && <label className="text-sm font-medium text-slate-900">
          {reportScope === "range" ? t("ตั้งแต่วันที่", "From") : t("วันที่", "Date")}
          <input type="date" className="mt-1 block rounded-lg border border-slate-200 bg-white px-2 py-1.5"
            value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
        </label>}
        {reportScope === "range" && <label className="text-sm font-medium text-slate-900">{t("ถึงวันที่", "Through")}
          <input type="date" min={reportDate} className="mt-1 block rounded-lg border border-slate-200 bg-white px-2 py-1.5"
            value={reportEnd} onChange={(event) => setReportEnd(event.target.value)} />
        </label>}
        <button type="button" disabled={reportBusy || !reportReady} onClick={() => void downloadReport()}
          className="registration-admin-control registration-admin-control-primary">
          {reportBusy ? t("กำลังสร้างรายงาน…", "Generating report…") : t("สร้าง PDF ตรวจยอดโอน", "Download transfer report PDF")}
        </button>
      </div>
      {reportError && <p role="alert" className="text-red-700">{reportError}</p>}
    </div>
  );
}
