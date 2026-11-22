import { useRef, useState } from "react";
import { MoreHorizontal, RefreshCw } from "lucide-react";
import type { AdminNotificationMutation } from "../../../backend/db/types";
import type { AppLanguage } from "../../lib/i18n";
import { notificationIsUnread, type NotificationState } from "./notificationState";

type Action = Exclude<AdminNotificationMutation["action"], "import">;
export type NotificationFilter = "active" | "unread" | "archived" | "trash";
export type InboxEntry = {
  id: string; reference: string; action: string; occurred_ms: number;
  first_name?: string; last_name?: string; booking_state?: string;
  total_minor?: number; attendee_count?: number;
};

export function NotificationInbox({
  language, filter, onFilter, rows, counts, state, busy, loading, summary, onReview,
  onRefresh, onAction, onOpen, hasMore, historyLoading, onLoadOlder, error, syncing,
}: {
  language: AppLanguage;
  filter: NotificationFilter;
  onFilter: (filter: NotificationFilter) => void;
  rows: InboxEntry[];
  counts: Record<NotificationFilter, number>;
  state: NotificationState;
  busy: boolean;
  loading: boolean;
  summary?: { pending: number; awaiting: number };
  onReview: () => void;
  onRefresh: () => void;
  onAction: (action: Action, ids?: string[]) => Promise<boolean>;
  onOpen: (entry: InboxEntry) => void;
  hasMore: boolean;
  historyLoading: boolean;
  onLoadOlder: () => void;
  error: string;
  syncing: boolean;
}) {
  const t = (th: string, en: string) => language === "th" ? th : en;
  const [selection, setSelection] = useState<string[]>([]);
  const [revealed, setRevealed] = useState("");
  const anchor = useRef("");
  const drag = useRef<{ id: string; y: number; original: string[]; moved: boolean } | null>(null);
  const swipe = useRef<{ id: string; x: number; y: number } | null>(null);
  const suppressOpen = useRef("");
  const ids = rows.map((row) => row.id);
  const selected = ids.filter((id) => selection.includes(id));
  const allSelected = ids.length > 0 && selected.length === ids.length;
  const partiallySelected = selected.length > 0 && !allSelected;
  const labels: Record<Action, string> = {
    read: t("ทำเครื่องหมายว่าอ่านแล้ว", "Mark read"),
    unread: t("ทำเครื่องหมายว่ายังไม่อ่าน", "Mark unread"),
    archive: t("เก็บถาวร", "Archive"),
    delete: t("ย้ายไปถังขยะ", "Move to trash"),
    restore: t("คืนเข้า Inbox", "Restore to inbox"),
    restore_deleted: t("นำออกจากถังขยะ", "Restore from trash"),
    read_all: t("อ่านแล้วทั้งหมด", "Mark all read"),
    restore_all: t("คืนรายการเก็บถาวรทั้งหมด", "Restore all archived"),
  };
  const rowActions: Action[] = filter === "trash" ? ["restore_deleted"] :
    ["read", "unread", filter === "archived" ? "restore" : "archive", "delete"];
  const money = new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", { style: "currency", currency: "THB" });
  const date = new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", {
    dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok",
  });

  function range(start: string, end: string) {
    const a = ids.indexOf(start);
    const b = ids.indexOf(end);
    return a < 0 || b < 0 ? [end] : ids.slice(Math.min(a, b), Math.max(a, b) + 1);
  }

  async function run(action: Action, targets?: string[]) {
    if (await onAction(action, targets)) {
      setSelection([]);
      setRevealed("");
      anchor.current = "";
    }
  }

  const control = "min-h-9 rounded-md px-2 text-sm font-medium hover:bg-blue-50 [html.theme-dark_&]:hover:bg-slate-800 disabled:opacity-50";

  return (
    <section className="surface-panel overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
        <h1 className="text-base font-semibold">{t("การแจ้งเตือน", "Notifications")}</h1>
        {summary && <button type="button" className="min-h-8 text-xs font-medium text-blue-700 hover:underline [html.theme-dark_&]:text-blue-300" onClick={onReview}>
          {t(`รอตรวจ ${summary.pending} · รอชำระ ${summary.awaiting} คน`, `${summary.pending} to review · ${summary.awaiting} awaiting payment`)}
        </button>}
        <button type="button" className={`${control} ml-auto`} title={t("รีเฟรช", "Refresh")}
          aria-label={t("รีเฟรช", "Refresh")} disabled={loading} onClick={onRefresh}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-slate-200 px-3 py-1 [html.theme-dark_&]:border-slate-700">
        <div className="flex flex-wrap items-center gap-0.5">
          {([["active", t("ทั้งหมด", "Inbox")], ["unread", t("ยังไม่อ่าน", "Unread")],
            ["archived", t("เก็บถาวร", "Archive")], ["trash", t("ถังขยะ", "Trash")]] as const).map(([key, label]) =>
            <button key={key} type="button" aria-pressed={filter === key}
              className={`${control} ${filter === key ? "bg-blue-100 text-blue-800 [html.theme-dark_&]:bg-blue-950 [html.theme-dark_&]:text-blue-200" : ""}`}
              onClick={() => { setSelection([]); setRevealed(""); anchor.current = ""; onFilter(key); }}>
              {label} <span className="text-xs tabular-nums">{counts[key]}</span>
            </button>)}
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <input type="checkbox" className="h-4 w-4 accent-blue-600" checked={allSelected}
            ref={(node) => { if (node) node.indeterminate = partiallySelected; }} aria-checked={partiallySelected ? "mixed" : allSelected}
            aria-label={t("เลือกทุกรายการที่แสดง", "Select all displayed notifications")} disabled={!ids.length || busy}
            onChange={() => { setSelection(allSelected ? [] : ids); anchor.current = ""; }} />
          {selected.length > 0 && <span className="whitespace-nowrap text-xs">{t(`เลือก ${selected.length} รายการ`, `${selected.length} selected`)}</span>}
        </div>
        <select className="max-w-full rounded-md border border-slate-200 bg-transparent px-2 py-1 text-sm [html.theme-dark_&]:border-slate-700"
          aria-label={t("จัดการการแจ้งเตือน", "Notification actions")} disabled={busy} value=""
          onChange={(event) => {
            const action = event.target.value;
            if (!action) return;
            if (action === "archive_read") void run("archive", rows.filter((row) => !notificationIsUnread(state, row)).map((row) => row.id));
            else if (action === "read_all" || action === "restore_all") void run(action);
            else void run(action as Action, selected);
          }}>
          <option value="">{selected.length ? t("จัดการรายการที่เลือก", "Manage selected") : t("จัดการ", "Actions")}</option>
          {selected.length ? rowActions.map((action) => <option key={action} value={action}>{labels[action]}</option>) : <>
            <option value="read_all" disabled={!counts.unread && !hasMore}>{labels.read_all}</option>
            {filter === "active" && <option value="archive_read" disabled={!rows.some((row) => !notificationIsUnread(state, row))}>
              {t("เก็บรายการที่อ่านแล้วที่แสดง", "Archive displayed read items")}
            </option>}
            {filter === "archived" && <option value="restore_all" disabled={!state.dismissedIds.length}>{labels.restore_all}</option>}
          </>}
        </select>
      </div>
      {error && <p role="alert" className="px-3 py-2 text-sm text-rose-700 [html.theme-dark_&]:text-rose-300">{error}</p>}
      {syncing && <p role="status" className="px-3 py-1 text-xs">{t("กำลังซิงก์…", "Syncing…")}</p>}
      {!loading && !rows.length && <p className="px-3 py-5 text-sm text-slate-500">{t("ไม่มีรายการในมุมมองนี้", "No notifications in this view")}</p>}
      <ul className="max-h-[72vh] divide-y divide-slate-200 overflow-y-auto [html.theme-dark_&]:divide-slate-700">
        {rows.map((entry) => {
          const unread = notificationIsUnread(state, entry);
          const checked = selected.includes(entry.id);
          const open = revealed === entry.id;
          const person = [entry.first_name, entry.last_name].filter(Boolean).join(" ") || t("ผู้จอง", "Booker");
          const title = ({
            create:t("ใบจองใหม่","New booking"), submit_proof:t("ส่งสลิปแล้ว","Payment slip submitted"),
            staff_submit_proof:t("แอดมินแนบสลิปแทนลูกค้า","Staff uploaded a payment slip"),
            review_verified:t("ตรวจสลิปผ่าน","Payment approved"), review_rejected:t("สลิปไม่ผ่าน","Payment rejected"),
            review_exception:t("ตรวจสอบยอดผิดปกติ","Payment exception"), customer_reinstate:t("ต่ออายุการจอง","Booking renewed"),
            admin_extend:t("ขยายเวลาชำระ","Payment deadline extended"), admin_cancel:t("ยกเลิกการจอง","Booking cancelled"),
            admin_reinstate:t("เปิดการจองอีกครั้ง","Booking reinstated"), admin_refund:t("คืนเงิน","Refund recorded"),
            expire:t("การจองหมดเวลา","Booking expired"),
          } as Record<string, string>)[entry.action] || entry.action;
          const status = ({
            awaiting_payment:t("รอชำระ","Awaiting payment"), verification_pending:t("รอตรวจสลิป","Awaiting review"),
            confirmed:t("ยืนยันแล้ว","Confirmed"), expired:t("หมดอายุ","Expired"), cancelled:t("ยกเลิก","Cancelled"),
          } as Record<string, string>)[entry.booking_state ?? ""];
          return (
            <li key={entry.id} className={`relative overflow-hidden ${checked ? "bg-blue-50 [html.theme-dark_&]:bg-blue-950/50" : ""}`}>
              {open && <div className="absolute inset-y-0 right-0 flex w-52 items-stretch justify-end sm:hidden">
                {rowActions.filter((action) => action !== (unread ? "unread" : "read")).map((action) =>
                  <button key={action} type="button" disabled={busy} aria-label={labels[action]} onClick={() => void run(action, [entry.id])}
                    className={`flex-1 px-1 text-xs font-semibold text-white ${action === "delete" ? "bg-rose-700" : "bg-blue-700"}`}>
                    {action === "read" ? t("อ่านแล้ว", "Read") : action === "unread" ? t("ยังไม่อ่าน", "Unread") :
                      action === "delete" ? t("ถังขยะ", "Trash") : labels[action]}
                  </button>)}
              </div>}
              <div className={`relative flex min-h-12 items-center gap-2 px-3 transition-transform sm:translate-x-0 ${open ? "-translate-x-52 bg-white [html.theme-dark_&]:bg-slate-900" : ""}`}>
                <input type="checkbox" className="hidden h-4 w-4 shrink-0 accent-blue-600 sm:block"
                  aria-label={t(`เลือก ${title} · ${person}`, `Select ${title} · ${person}`)}
                  data-notification-id={entry.id} checked={checked} disabled={busy} onChange={() => {}}
                  onPointerDown={(event) => {
                    drag.current = null;
                    if (event.pointerType !== "mouse" || event.button !== 0 || event.shiftKey) return;
                    drag.current = { id: entry.id, y: event.clientY, original: selected, moved: false };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const start = drag.current;
                    if (!start || !event.buttons || (!start.moved && Math.abs(event.clientY - start.y) < 6)) return;
                    const target = document.elementFromPoint(event.currentTarget.getBoundingClientRect().left + 4, event.clientY)
                      ?.closest("li")?.querySelector<HTMLInputElement>("[data-notification-id]")?.dataset.notificationId;
                    if (!target) return;
                    start.moved = true;
                    setSelection([...new Set([...start.original, ...range(start.id, target)])]);
                  }}
                  onPointerCancel={() => { drag.current = null; }}
                  onClick={(event) => {
                    const dragged = drag.current?.moved;
                    drag.current = null;
                    if (!dragged) {
                      if (event.shiftKey && anchor.current) setSelection([...new Set([...selected, ...range(anchor.current, entry.id)])]);
                      else setSelection(checked ? selected.filter((id) => id !== entry.id) : [...selected, entry.id]);
                    }
                    anchor.current = entry.id;
                  }} />
                <button type="button" className="grid min-h-12 min-w-0 flex-1 touch-pan-y grid-cols-[.5rem_minmax(0,1fr)_auto] items-center gap-x-2 py-1 text-left sm:min-h-10"
                  onPointerDown={(event) => {
                    suppressOpen.current = "";
                    if (event.pointerType === "touch") swipe.current = { id: entry.id, x: event.clientX, y: event.clientY };
                  }}
                  onPointerCancel={() => { swipe.current = null; }}
                  onPointerUp={(event) => {
                    const start = swipe.current;
                    swipe.current = null;
                    if (!start || start.id !== entry.id) return;
                    const dx = event.clientX - start.x;
                    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(event.clientY - start.y) * 1.4) {
                      suppressOpen.current = entry.id;
                      setRevealed(dx < 0 ? entry.id : "");
                    }
                  }}
                  onClick={() => {
                    if (suppressOpen.current === entry.id) { suppressOpen.current = ""; return; }
                    if (open) { setRevealed(""); return; }
                    onOpen(entry);
                  }}>
                  <span className={`h-2 w-2 rounded-full ${unread ? "bg-blue-500" : ""}`} aria-label={unread ? t("ยังไม่อ่าน", "Unread") : undefined} />
                  <span className="min-w-0 truncate text-sm" title={`${title} · ${person} · ${status ?? ""} · ${entry.reference}`}>
                    <span className={unread ? "font-bold" : "font-medium"}>{title} · {person}</span>
                    <span className="block truncate text-xs text-slate-500 [html.theme-dark_&]:text-slate-300 sm:ml-2 sm:inline">
                      {[status, entry.attendee_count != null ? t(`${entry.attendee_count} คน`, `${entry.attendee_count} guests`) : null,
                        entry.total_minor != null ? money.format(Number(entry.total_minor) / 100) : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <time dateTime={new Date(entry.occurred_ms).toISOString()} className="whitespace-nowrap text-right text-xs tabular-nums text-slate-500 [html.theme-dark_&]:text-slate-300">{date.format(entry.occurred_ms)}</time>
                </button>
                <button className="grid h-11 w-9 shrink-0 place-items-center sm:hidden" type="button" disabled={busy}
                  aria-label={t("คำสั่งสำหรับรายการนี้", "Actions for this notification")} aria-expanded={open}
                  onClick={() => setRevealed(open ? "" : entry.id)}><MoreHorizontal className="h-5 w-5" /></button>
              </div>
            </li>
          );
        })}
      </ul>
      {hasMore && <button type="button" disabled={historyLoading} className={`${control} w-full border-t border-slate-200 [html.theme-dark_&]:border-slate-700`}
        onClick={onLoadOlder}>{historyLoading ? t("กำลังโหลด…", "Loading…") : t("โหลดรายการเก่า", "Load older notifications")}</button>}
    </section>
  );
}
