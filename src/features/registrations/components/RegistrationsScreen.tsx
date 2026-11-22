import { useEffect, useMemo, useState } from "react";
import { RegistrationStatusTag, getRosterStatus } from "./RegistrationStatusTag";
import { PaidAttendeeRoster } from "./PaidAttendeeRoster";
import type { PaidRosterPerson,PaidRosterSummary } from "./paidRosterTypes";
import type { ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  MessageCircle,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";

import {
  ActionButton,
  InlineActionsMenu,
  MenuActionItem,
  MenuActionLink,
  SelectionMarker,
  StatusBadge,
  StatusLine,
  type BadgeTone,
} from "../../../components/shared/AppUi";
import { translate, type AppLanguage } from "../../../lib/i18n";

type RegistrationStatus = "registered" | "cancelled" | "checked-in";

type RegistrationRecord = {
  id: string;
  sender_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  channel_platform?: string | null;
  channel_external_id?: string | null;
  sms_opt_in_at?: string | null;
  sms_opt_out_at?: string | null;
  timestamp: string;
  status: string;
};

export type RegistrationChatBatch = {
  key: string;
  sender_id: string;
  channel_platform: string | null;
  channel_external_id: string | null;
  ticket_count: number;
  active_ticket_count: number;
  cancelled_ticket_count: number;
  last_registration_at: string;
  registrations: RegistrationRecord[];
};

export type RegistrationSortKey = "timestamp" | "name";
export type RegistrationSortDirection = "asc" | "desc";
export type RegistrationStatusFilter = "all" | RegistrationStatus;

type RegistrationAvailabilitySummary = {
  label: string;
  helper: string;
  tone: BadgeTone;
};

type RegistrationCapacitySummary = {
  limit: number | null;
  remaining: number;
  fillPercent: number;
  isFull: boolean;
};

type RegistrationsScreenProps = {
  filteredRegistrations: RegistrationRecord[];
  registrationAvailability: RegistrationAvailabilitySummary;
  registrationCapacity: RegistrationCapacitySummary;
  activeAttendeeCount: number;
  selectedEventId: string;
  registrationListQuery: string;
  onRegistrationListQueryChange: (value: string) => void;
  deferredRegistrationListQuery: string;
  registrationSortKey: RegistrationSortKey;
  registrationSortDirection: RegistrationSortDirection;
  onRegistrationSortChange: (key: RegistrationSortKey) => void;
  registrationStatusFilter: RegistrationStatusFilter;
  onRegistrationStatusFilterChange: (filter: RegistrationStatusFilter) => void;
  visibleRegistrations: RegistrationRecord[];
  selectedRegistrationId: string;
  onSelectRegistration: (registrationId: string) => void;
  getSearchTargetDomId: (kind: "registration", id: string) => string;
  isSearchFocused: (kind: "registration", id: string) => boolean;
  getRegistrationStatusTone: (status: string) => BadgeTone;
  hasMoreRegistrations: boolean;
  onLoadMoreRegistrations: () => void;
  registrationListLoadingMore: boolean;
  registrationsCount: number;
  registeredCount: number;
  checkedInCount: number;
  cancelledCount: number;
  checkInRate: number;
  selectedRegistration: RegistrationRecord | null;
  chatBatches: RegistrationChatBatch[];
  chatBatchesLoading: boolean;
  chatBatchLoadingKey: string;
  chatBatchMessage: string;
  onResendChatBatch: (batch: RegistrationChatBatch) => unknown;
  registrationTicketResendLoadingId: string;
  registrationTicketResendMessage: string;
  onResendRegistrationTicket: (registration: RegistrationRecord) => unknown;
  selectedTicketPreview: ReactNode;
  selectedTicketPngUrl: string;
  selectedTicketSvgUrl: string;
  canChangeRegistrationStatus: boolean;
  onDeleteRegistration: (registrationId: string) => unknown;
  deleteRegistrationLoading: boolean;
  onUpdateRegistrationStatus: (registrationId: string, status: RegistrationStatus) => unknown;
  onUpdateRegistrationSmsConsent: (registrationId: string, consent: boolean) => unknown;
  statusUpdateLoading: boolean;
  statusUpdateMessage: string;
  language: AppLanguage;
  apiFetch?: (input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
};

export function RegistrationsScreen({
  filteredRegistrations,
  registrationAvailability,
  registrationCapacity,
  activeAttendeeCount,
  selectedEventId,
  registrationListQuery,
  onRegistrationListQueryChange,
  deferredRegistrationListQuery,
  registrationSortKey,
  registrationSortDirection,
  onRegistrationSortChange,
  registrationStatusFilter,
  onRegistrationStatusFilterChange,
  visibleRegistrations,
  selectedRegistrationId,
  onSelectRegistration,
  getSearchTargetDomId,
  isSearchFocused,
  getRegistrationStatusTone,
  hasMoreRegistrations,
  onLoadMoreRegistrations,
  registrationListLoadingMore,
  registrationsCount,
  registeredCount,
  checkedInCount,
  cancelledCount,
  checkInRate,
  selectedRegistration,
  chatBatches,
  chatBatchesLoading,
  chatBatchLoadingKey,
  chatBatchMessage,
  onResendChatBatch,
  registrationTicketResendLoadingId,
  registrationTicketResendMessage,
  onResendRegistrationTicket,
  selectedTicketPreview,
  selectedTicketPngUrl,
  selectedTicketSvgUrl,
  canChangeRegistrationStatus,
  onDeleteRegistration,
  deleteRegistrationLoading,
  onUpdateRegistrationStatus,
  onUpdateRegistrationSmsConsent,
  statusUpdateLoading,
  statusUpdateMessage,
  language,
  apiFetch,
}: RegistrationsScreenProps) {
  const [paidPeople,setPaidPeople]=useState<PaidRosterPerson[]>([]);
  const [paidSummary,setPaidSummary]=useState<PaidRosterSummary|null>(null);
  const [paidError,setPaidError]=useState<"access" | "request" | null>(null);
  const [paidRevision,setPaidRevision]=useState(0);
  useEffect(()=>{
    const update=()=>setPaidRevision(n=>n+1);
    window.addEventListener("meetrix:paid-booking-updated",update);
    return ()=>window.removeEventListener("meetrix:paid-booking-updated",update);
  },[]);
  useEffect(()=>{
    if(!apiFetch||!selectedEventId)return;
    let mounted=true;
    const controller=new AbortController();
    apiFetch("/api/events/"+encodeURIComponent(selectedEventId)+"/paid-registration/attendees",
      {signal:controller.signal}).then(async res=>{
      if (res.status === 403) {
        if (mounted) { setPaidPeople([]); setPaidSummary(null); setPaidError("access"); }
        return null;
      }
      if(!res.ok)throw new Error("Could not load paid attendees");
      return res.json();
    }).then(result=>{
      if(mounted && result){setPaidPeople(result.attendees??[]);setPaidSummary(result.summary??null);setPaidError(null);}
    }).catch(()=>{
      if(mounted){setPaidPeople([]);setPaidSummary(null);setPaidError("request");}
    });
    return ()=>{mounted=false;controller.abort();};
  },[apiFetch,selectedEventId,paidRevision]);
  const filteredPaid=useMemo(()=>{
    const search=registrationListQuery.trim().toLowerCase();
    return paidPeople.filter(person=>(!search||
      [person.first_name,person.last_name,person.booking_reference,
        person.customer_first_name,person.customer_last_name,person.customer_email]
        .join(" ").toLowerCase().includes(search)) &&
      (registrationStatusFilter==="all" ||
       registrationStatusFilter==="checked-in" && person.checked_in_ms!=null ||
       registrationStatusFilter==="cancelled" && ["expired","cancelled"].includes(person.booking_state) ||
       registrationStatusFilter==="registered" && person.checked_in_ms==null &&
         ["confirmed","awaiting_payment","verification_pending","payment_exception"].includes(person.booking_state)));
  },[paidPeople,registrationListQuery,registrationStatusFilter]);
  const baht = new Intl.NumberFormat(language === "th" ? "th-TH" : "en-GB", { style: "currency", currency: "THB" });
  const paidReserved=paidSummary?Number(paidSummary.confirmed_attendees)+Number(paidSummary.held_attendees):0;
  const shownOccupied=activeAttendeeCount+paidReserved;
  const shownCapacity=paidSummary?Number(paidSummary.capacity):registrationCapacity.limit;
  const shownRemaining=shownCapacity==null?null:Math.max(0,shownCapacity-shownOccupied);
  const shownPercent=shownCapacity==null?0:Math.min(100,Math.round(shownOccupied/shownCapacity*100));
  const shownTotal=registrationsCount+(paidSummary?Number(paidSummary.attendees):0);
  const shownChecked=checkedInCount+(paidSummary?Number(paidSummary.checked_in_attendees):0);
  const shownRegistered=registeredCount+(paidSummary?
    Number(paidSummary.confirmed_attendees)+Number(paidSummary.held_attendees)-Number(paidSummary.checked_in_attendees):0);
  const shownCancelled=cancelledCount+paidPeople.filter(person=>
    ["expired","cancelled"].includes(person.booking_state)).length;
  const shownCheckinRate=shownChecked+shownRegistered>0?
    Math.round(100*shownChecked/(shownChecked+shownRegistered)):0;

  const t = (key: string, fallback: string) => translate(language, `registrations.${key}`, fallback);
  const statusLabel = (status: string) => t(`status.${status}`, status);
  const formatDate = (value: string) => new Date(value).toLocaleString(language === "th" ? "th-TH" : "en-US");
  const statsCardClass = (filter: RegistrationStatusFilter, colors: string) =>
    `w-full rounded-xl border px-3 py-2.5 text-left transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${colors} ${
      registrationStatusFilter === filter ? "ring-2 ring-blue-500 ring-offset-1" : ""
    }`;
  const renderSortButton = (key: RegistrationSortKey, label: string, className = "") => {
    const active = registrationSortKey === key;
    const directionLabel = registrationSortDirection === "asc" ? "ascending" : "descending";
    return (
      <button
        type="button"
        onClick={() => onRegistrationSortChange(key)}
        aria-pressed={active}
        aria-label={`${label} ${active ? directionLabel : "sort"}`}
        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold normal-case tracking-normal transition-colors ${
          active ? "bg-blue-100 text-blue-700" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        } ${className}`}
      >
        <span>{label}</span>
        <span aria-hidden="true">{active ? (registrationSortDirection === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    );
  };
  const chatBatchMessageIsError = chatBatchMessage.includes("ส่งไม่สำเร็จ")
    || chatBatchMessage.includes("ล้มเหลว")
    || chatBatchMessage.toLowerCase().includes("failed")
    || chatBatchMessage.toLowerCase().includes("error");
  const registrationTicketMessageIsError = registrationTicketResendMessage.includes("ส่งไม่สำเร็จ")
    || registrationTicketResendMessage.includes("ล้มเหลว")
    || registrationTicketResendMessage.includes("ไม่พบ")
    || registrationTicketResendMessage.toLowerCase().includes("failed")
    || registrationTicketResendMessage.toLowerCase().includes("error");
  const hasRegistrationTicketSource = (registration: RegistrationRecord) => Boolean(
    registration.sender_id.trim()
    && (registration.channel_external_id?.trim() || registration.channel_platform)
    && registration.channel_platform !== "web_chat",
  );
  const canResendRegistrationTicket = (registration: RegistrationRecord) => Boolean(
    canChangeRegistrationStatus
    && registration.status !== "cancelled"
    && hasRegistrationTicketSource(registration),
  );
  const registrationTicketDisabledReason = (registration: RegistrationRecord) => {
    if (registration.status === "cancelled") return t("resendCancelled", "Cancelled");
    if (!hasRegistrationTicketSource(registration)) return t("resendNoChannel", "No source chat");
    return "";
  };
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,23rem)]">
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">{t("title", "Registered Attendees")}</h2>
              <StatusLine
                className="mt-0.5"
                items={[
                  String(filteredRegistrations.length+filteredPaid.length)+" "+t("results", "results"),
                  registrationAvailability.label,
                ]}
              />
              <p className="text-xs text-slate-500">
                {paidSummary
                  ? String(shownOccupied)+"/"+String(shownCapacity)+" ที่นั่งจอง/ยืนยันแล้ว · "+
                    String(shownRemaining)+" คงเหลือ (รวม Paid Booking)"
                  : String(activeAttendeeCount)+" ผู้เข้าร่วมจากระบบ Event เดิม"}
              </p>
            </div>
            <InlineActionsMenu label={t("actions", "Actions")} tone="neutral">
              <MenuActionLink
                href={`/api/registrations/export?event_id=${encodeURIComponent(selectedEventId)}`}
                tone="neutral"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="font-medium">Export ทุกคน (Excel / CSV)</span>
              </MenuActionLink>
            </InlineActionsMenu>
          </div>
          <div className="border-b border-slate-100 px-3 py-2.5 sm:px-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <label htmlFor="registration-search" className="sr-only">{t("searchLabel", "Search registrations")}</label>
              <input
                id="registration-search"
                value={registrationListQuery}
                onChange={(event) => onRegistrationListQueryChange(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-10 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t("searchPlaceholder", "Search by name, registration ID, phone, or email")}
              />
              {registrationListQuery && (
                <button
                  type="button"
                  onClick={() => onRegistrationListQueryChange("")}
                  className="absolute right-3 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                  aria-label={t("clearSearch", "Clear registration search")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 md:hidden">
              <span className="mr-1 text-[10px] font-semibold text-slate-400">{t("sortBy", "Sort by")}</span>
              {renderSortButton("timestamp", t("time", "Time"))}
              {renderSortButton("name", t("name", "Name"))}
            </div>
          </div>
          {registrationTicketResendMessage && (
            <div
              aria-live="polite"
              className={`mx-3 mt-3 rounded-xl border px-3 py-2 text-xs font-medium sm:mx-4 ${
                registrationTicketMessageIsError
                  ? "border-rose-200 bg-rose-50 text-rose-800"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                {registrationTicketMessageIsError
                  ? <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                {registrationTicketResendMessage}
              </span>
            </div>
          )}
          {paidError && <div role="alert" className="flex flex-wrap items-center gap-2 p-3 text-xs text-red-700">
            <p>{paidError === "access"
              ? (language === "th" ? "บัญชีนี้ไม่มีสิทธิ์ดูรายชื่อ Paid Booking ของงานนี้" : "This account cannot view the paid roster for this event.")
              : (language === "th" ? "โหลดรายชื่อ Paid Booking ไม่สำเร็จ" : "Could not load the paid roster.")}</p>
            {paidError === "request" && <button type="button" className="font-semibold underline" onClick={() => setPaidRevision((value) => value + 1)}>
              {language === "th" ? "ลองอีกครั้ง" : "Retry"}
            </button>}
          </div>}
          <PaidAttendeeRoster language={language} people={filteredPaid} total={paidPeople.length}
            onRefresh={()=>setPaidRevision(n=>n+1)}/>
          <div className={paidPeople.length>0 && registrationsCount===0 ?
            "hidden" : "max-h-[28rem] space-y-2 overflow-y-auto p-3 md:hidden"}>
            {filteredRegistrations.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
                {deferredRegistrationListQuery || registrationStatusFilter !== "all"
                  ? t("noMatch", "No attendees match this filter.")
                  : paidPeople.length>0?"ไม่มีรายชื่อจากระบบเดิม (Legacy)":t("noRegistrations", "No registrations yet.")}
              </div>
            ) : (
              visibleRegistrations.map((registration) => (
                <div
                  key={registration.id}
                  id={getSearchTargetDomId("registration", registration.id)}
                  onClick={() => onSelectRegistration(registration.id)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectRegistration(registration.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  data-registration-status={getRosterStatus(registration.status)}
                  className={`registration-status-card w-full rounded-2xl border px-3 py-2.5 text-left transition-colors ${
                    selectedRegistrationId === registration.id
                      ? "border-blue-200 bg-blue-50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  } ${isSearchFocused("registration", registration.id) ? "ring-2 ring-blue-200 ring-offset-2" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{registration.first_name} {registration.last_name}</p>
                      <p className="mt-0.5 font-mono text-[11px] font-bold text-blue-600">{registration.id}</p>
                      <p className="mt-0.5 truncate text-[10px] text-slate-500">
                        {registration.phone || registration.email || t("noContact", "No contact info")}
                      </p>
                      {registration.channel_platform && <p className="mt-0.5 text-[10px] font-medium text-blue-600">{registration.channel_platform === "facebook" ? "Messenger" : registration.channel_platform}</p>}
                      {registration.sms_opt_in_at && !registration.sms_opt_out_at && <p className="mt-0.5 text-[10px] font-medium text-emerald-600">SMS consent</p>}
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      <RegistrationStatusTag status={getRosterStatus(registration.status)} language={language} />
                      {selectedRegistrationId === registration.id && <SelectionMarker />}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] text-slate-500">{formatDate(registration.timestamp)}</p>
                    <ActionButton
                      tone="blue"
                      className="min-h-8 shrink-0 px-2.5 py-1.5 text-[10px]"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onResendRegistrationTicket(registration);
                      }}
                      disabled={!canResendRegistrationTicket(registration) || Boolean(registrationTicketResendLoadingId)}
                      title={registrationTicketDisabledReason(registration) || t("resendTicket", "Resend ticket")}
                      aria-label={`${t("resendTicket", "Resend ticket")} ${registration.id}`}
                    >
                      {registrationTicketResendLoadingId === registration.id
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <Send className="h-3.5 w-3.5" />}
                      {registrationTicketResendLoadingId === registration.id
                        ? t("resendingTicket", "Sending...")
                        : t("resendTicket", "Resend ticket")}
                    </ActionButton>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className={paidPeople.length>0 && registrationsCount===0 ?
            "hidden" : "hidden max-h-[38rem] overflow-auto md:block"}>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                <tr>
                  <th className="px-4 py-2.5">ID</th>
                  <th
                    className="px-4 py-2.5"
                    aria-sort={registrationSortKey === "name" ? (registrationSortDirection === "asc" ? "ascending" : "descending") : "none"}
                  >
                    {renderSortButton("name", t("name", "Name"), "px-0")}
                  </th>
                  <th
                    className="px-4 py-2.5"
                    aria-sort={registrationSortKey === "timestamp" ? (registrationSortDirection === "asc" ? "ascending" : "descending") : "none"}
                  >
                    {renderSortButton("timestamp", t("time", "Time"), "px-0")}
                  </th>
                  <th className="px-4 py-2.5">{t("contact", "Contact")}</th>
                  <th className="px-4 py-2.5">{t("channel", "Channel")}</th>
                  <th className="px-4 py-2.5">SMS</th>
                  <th className="px-4 py-2.5">{t("ticket", "Ticket")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRegistrations.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-400 italic">
                      {deferredRegistrationListQuery || registrationStatusFilter !== "all"
                        ? t("noMatch", "No attendees match this filter.")
                        : paidPeople.length>0?"ไม่มีรายชื่อจากระบบเดิม (Legacy)":t("noRegistrations", "No registrations yet.")}
                    </td>
                  </tr>
                ) : (
                  visibleRegistrations.map((registration) => (
                    <tr
                      key={registration.id}
                      id={getSearchTargetDomId("registration", registration.id)}
                      onClick={() => onSelectRegistration(registration.id)}
                      data-registration-status={getRosterStatus(registration.status)}
                      className={`registration-row hover:bg-slate-50 transition-colors cursor-pointer ${
                        selectedRegistrationId === registration.id ? "registration-row-selected bg-blue-50" : ""
                      } ${
                        isSearchFocused("registration", registration.id) ? "bg-blue-50" : ""
                      }`}
                    >
                      <td className="px-4 py-2.5 font-mono text-[11px] font-bold text-blue-600">
                        {registration.id}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-medium">{registration.first_name} {registration.last_name}</span>
                          <RegistrationStatusTag status={getRosterStatus(registration.status)} language={language} />
                        </div>
                        {selectedRegistrationId === registration.id && (
                          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-blue-600">{t("selected", "Selected")}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-slate-600">
                        {formatDate(registration.timestamp)}
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="text-[11px]">{registration.phone}</p>
                        <p className="text-[10px] text-slate-400">{registration.email}</p>
                      </td>
                      <td className="px-4 py-2.5 text-[11px] text-slate-600">
                        {registration.channel_platform === "facebook" ? "Messenger" : registration.channel_platform || "-"}
                      </td>
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={Boolean(registration.sms_opt_in_at && !registration.sms_opt_out_at)}
                          disabled={!canChangeRegistrationStatus || statusUpdateLoading}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => void onUpdateRegistrationSmsConsent(registration.id, event.target.checked)}
                          aria-label={`SMS consent for ${registration.first_name} ${registration.last_name}`}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <ActionButton
                          tone="blue"
                          className="min-h-8 whitespace-nowrap px-2.5 py-1.5 text-[10px]"
                          onClick={(event) => {
                            event.stopPropagation();
                            void onResendRegistrationTicket(registration);
                          }}
                          disabled={!canResendRegistrationTicket(registration) || Boolean(registrationTicketResendLoadingId)}
                          title={registrationTicketDisabledReason(registration) || t("resendTicket", "Resend ticket")}
                          aria-label={`${t("resendTicket", "Resend ticket")} ${registration.id}`}
                        >
                          {registrationTicketResendLoadingId === registration.id
                            ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                            : <Send className="h-3.5 w-3.5" />}
                          {registrationTicketResendLoadingId === registration.id
                            ? t("resendingTicket", "Sending...")
                            : t("resendTicket", "Resend ticket")}
                        </ActionButton>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className={paidPeople.length>0 && registrationsCount===0 ? "hidden" :
            "flex flex-col gap-2 border-t border-slate-100 px-3 py-2.5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-4"}>
            <p>
              {t("showing", "Showing")} {visibleRegistrations.length} {t("of", "of")} {filteredRegistrations.length} {t("attendees", "attendees")}
            </p>
            {hasMoreRegistrations && (
              <ActionButton
                onClick={onLoadMoreRegistrations}
                disabled={registrationListLoadingMore}
                tone="neutral"
                className="w-full text-sm sm:w-auto"
              >
                {registrationListLoadingMore && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                {registrationListLoadingMore ? t("loadingMore", "Loading...") : t("loadMore", "Load 120 More")}
              </ActionButton>
            )}
          </div>
        </div>

        <div className="surface-panel surface-panel-violet rounded-2xl p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-violet-950">
                <MessageCircle className="h-4 w-4 text-violet-700" />
                {t("chatBatchesTitle", "Chat ticket batches")}
              </h3>
              <p className="mt-0.5 text-xs text-violet-700 opacity-80">
                {t("chatBatchesHint", "One Facebook chat can contain registrations for several people. Send all active tickets back to that chat.")}
              </p>
            </div>
            <StatusBadge tone="violet">{chatBatches.length} {t("chatCount", "chats")}</StatusBadge>
          </div>

          {chatBatchMessage && (
            <div
              aria-live="polite"
              className={`mt-3 rounded-xl border px-3 py-2 text-xs font-medium ${
                chatBatchMessageIsError
                  ? "border-rose-200 bg-rose-50 text-rose-800"
                  : "border-violet-200 bg-white text-violet-900"
              }`}
            >
              {chatBatchMessage}
            </div>
          )}

          {chatBatchesLoading ? (
            <div className="surface-frame mt-3 rounded-xl p-4 text-center text-xs text-violet-700 opacity-80">
              {t("chatBatchesLoading", "Loading chat batches...")}
            </div>
          ) : chatBatches.length === 0 ? (
            <div className="surface-frame mt-3 rounded-xl border border-dashed border-violet-200 p-4 text-center text-xs text-violet-700">
              {t("chatBatchesEmpty", "No channel-linked registration chats found.")}
            </div>
          ) : (
            <div className="mt-3 max-h-[25rem] space-y-2 overflow-y-auto pr-1">
              {chatBatches.map((batch) => {
                const loading = chatBatchLoadingKey === batch.key;
                return (
                  <div key={batch.key} className="surface-tile rounded-xl p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900">
                          {batch.active_ticket_count} {t("activeTickets", "active ticket(s)")} · {batch.ticket_count} {t("registrationCount", "registration(s)")}
                        </p>
                        <p className="mt-1 break-all font-mono text-[10px] text-violet-700">{t("chatId", "Chat ID")}: {batch.sender_id}</p>
                        {batch.channel_external_id && (
                          <p className="mt-1 break-all font-mono text-[10px] text-slate-500">Page/Channel ID: {batch.channel_external_id}</p>
                        )}
                        <p className="mt-1 text-[10px] text-slate-500">
                          {batch.registrations.slice(0, 4).map((registration) => `${registration.first_name} ${registration.last_name}`.trim() || registration.id).map((label, index) => `${label} · ${batch.registrations[index].id}`).join(", ")}
                          {batch.registrations.length > 4 ? ` +${batch.registrations.length - 4} more` : ""}
                        </p>
                        {batch.cancelled_ticket_count > 0 && (
                          <p className="mt-1 text-[10px] text-amber-700">{batch.cancelled_ticket_count} {t("cancelledSkipped", "cancelled ticket(s) skipped")}</p>
                        )}
                      </div>
                      <ActionButton
                        onClick={() => void onResendChatBatch(batch)}
                        disabled={!canChangeRegistrationStatus || loading || batch.active_ticket_count === 0}
                        tone="blue"
                        className="shrink-0 px-2.5 py-1.5 text-[11px]"
                      >
                        {loading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        {loading ? t("sending", "Sending...") : t("sendAll", "Send all")}
                      </ActionButton>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="registration-dashboard-stats bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-600" />
                {t("eventStats", "Event Stats")}
              </h3>
              <p className="hidden text-xs text-slate-500 sm:block">{t("eventStatsHint", "Glanceable live totals for this event.")}</p>
            </div>
            <StatusBadge tone={registrationAvailability.tone}>{registrationAvailability.label}</StatusBadge>
          </div>
          {paidError && <p className="mb-3 text-xs text-amber-700">{language === "th"
            ? "ยอดด้านล่างมาจากระบบลงทะเบียนเดิมเท่านั้น เพราะยังโหลดข้อมูล Paid Booking ไม่ได้"
            : "These totals show legacy registrations only because paid booking data could not be loaded."}</p>}
          {paidSummary && <dl className="mb-3 grid grid-cols-2 gap-2">
            {[
              { label: language === "th" ? "ยอดรวมตามใบจอง" : "Total booking value",
                minor: Number(paidSummary.accepted_minor) + Number(paidSummary.unsettled_due_minor) },
              { label: language === "th" ? "ตรวจยืนยันแล้ว" : "Verified payments", minor: Number(paidSummary.accepted_minor) },
              { label: language === "th" ? "ยอดตามสลิปรอตรวจ" : "Slip amounts under review", minor: Number(paidSummary.pending_slip_minor) },
              { label: language === "th" ? "ยอดใบจองรอชำระ" : "Awaiting payment", minor: Number(paidSummary.awaiting_payment_due_minor) },
              ...(Number(paidSummary.slip_shortfall_minor) > 0 ? [{
                label: language === "th" ? "ยอดขาดตามสลิปรอตรวจ" : "Shortfall on slips under review",
                minor: Number(paidSummary.slip_shortfall_minor),
              }] : []),
            ].map(({ label, minor }) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                <dt className="text-xs text-slate-600">{label}</dt>
                <dd className="break-words text-base font-bold tabular-nums text-slate-900">{baht.format(minor / 100)}</dd>
              </div>
            ))}
          </dl>}
          {paidSummary&&<div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="registration-booking-stat registration-booking-stat-unpaid rounded-lg p-2"><strong className="block text-lg">{paidSummary.awaiting_payment_bookings}</strong>Booking รอชำระ</div>
            <div className="registration-booking-stat registration-booking-stat-review rounded-lg p-2"><strong className="block text-lg">{paidSummary.pending_review_bookings}</strong>Booking รอตรวจสลิป</div>
            <div className="registration-booking-stat registration-booking-stat-confirmed rounded-lg p-2"><strong className="block text-lg">{paidSummary.confirmed_bookings}</strong>Booking ยืนยันแล้ว</div>
          </div>}
          <div className="space-y-2.5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{t("seatCapacity", "Seat Capacity")}</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">
                    {shownCapacity === null ? shownOccupied : String(shownOccupied)+"/"+String(shownCapacity)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {shownCapacity === null
                      ? t("noCapacityLimit", "No hard capacity limit is configured for this event.")
                      : shownRemaining === 0
                      ? t("noSeatsRemaining", "No seats remaining. Registration now stops at capacity.")
                      : `${shownRemaining} ${t("seatsAutoClose", "seats remain before registration auto-closes for capacity.")}`}
                  </p>
                </div>
                {shownCapacity !== null && (
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{t("filled", "Filled")}</p>
                    <p className="mt-1 text-lg font-bold text-slate-900">{shownPercent}%</p>
                  </div>
                )}
              </div>
              {shownCapacity !== null && (
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full transition-[width] ${
                      shownRemaining === 0 ? "bg-rose-500" : "bg-blue-600"
                    }`}
                    style={{ width: `${shownPercent}%` }}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={statsCardClass("all", "border-slate-200 bg-white")}
                onClick={() => onRegistrationStatusFilterChange("all")}
                aria-pressed={registrationStatusFilter === "all"}
                aria-label={`${t("total", "Total")}: ${shownTotal}`}
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{t("total", "Total")}</p>
                <p className="mt-1 text-base font-bold text-slate-900">{shownTotal}</p>
              </button>
              <button
                type="button"
                className={statsCardClass("registered", "border-blue-100 bg-blue-50")}
                onClick={() => onRegistrationStatusFilterChange("registered")}
                aria-pressed={registrationStatusFilter === "registered"}
                aria-label={`${t("registered", "Registered")}: ${shownRegistered}`}
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">{t("registered", "Registered")}</p>
                <p className="mt-1 text-base font-bold text-blue-700">{shownRegistered}</p>
              </button>
              <button
                type="button"
                className={statsCardClass("checked-in", "border-emerald-100 bg-emerald-50")}
                onClick={() => onRegistrationStatusFilterChange("checked-in")}
                aria-pressed={registrationStatusFilter === "checked-in"}
                aria-label={`${t("checked", "Checked")}: ${shownChecked}`}
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-600">{t("checked", "Checked")}</p>
                <p className="mt-1 text-base font-bold text-emerald-700">{shownChecked}</p>
              </button>
              <button
                type="button"
                className={statsCardClass("cancelled", "border-rose-100 bg-rose-50")}
                onClick={() => onRegistrationStatusFilterChange("cancelled")}
                aria-pressed={registrationStatusFilter === "cancelled"}
                aria-label={`${t("cancelled", "Cancelled")}: ${shownCancelled}`}
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-rose-600">{t("cancelled", "Cancelled")}</p>
                <p className="mt-1 text-base font-bold text-rose-700">{shownCancelled}</p>
              </button>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{t("checkInRate", "Check-in Rate")}</p>
                <p className="mt-1 text-xs text-slate-500">{registrationAvailability.helper}</p>
              </div>
              <p className="text-lg font-bold text-violet-700">{paidSummary?shownCheckinRate:checkInRate}%</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-base font-semibold">{selectedRegistration?t("selectedTicket", "Selected Ticket"):"Legacy Ticket Preview"}</h3>
              <p className="text-xs text-slate-500">{t("selectedTicketHint", "Click a registration row to preview, download, and edit status.")}</p>
            </div>
            {selectedRegistration && (
              <StatusBadge tone={getRegistrationStatusTone(selectedRegistration.status)}>
                {statusLabel(selectedRegistration.status)}
              </StatusBadge>
            )}
          </div>

          {!selectedRegistration ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
              {paidPeople.length>0?"Paid Booking tickets are issued after approval in Slip Review.":t("noAttendeeSelected", "No attendee selected yet.")}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="max-h-[23rem] overflow-auto rounded-2xl bg-slate-50 p-1.5">
                {selectedTicketPreview}
              </div>

              <div className="flex flex-wrap gap-1.5">
                <a
                  href={selectedTicketPngUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-blue-600 bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(37,99,235,0.18)] transition-colors sm:flex-none"
                >
                  <ExternalLink className="w-4 h-4" />
                  {t("openPng", "Open PNG Ticket")}
                </a>
                <InlineActionsMenu label={t("ticketActions", "Ticket Actions")} tone="neutral">
                  <MenuActionLink
                    href={selectedTicketPngUrl}
                    download={`${selectedRegistration.id}.png`}
                    tone="neutral"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span className="font-medium">{t("downloadPng", "Download PNG")}</span>
                  </MenuActionLink>
                  <MenuActionLink
                    href={selectedTicketSvgUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    tone="blue"
                    className="mt-1"
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    <span className="font-medium">{t("openSvg", "Open SVG Preview")}</span>
                  </MenuActionLink>
                  {canChangeRegistrationStatus && (
                    <MenuActionItem
                      onClick={() => void onDeleteRegistration(selectedRegistration.id)}
                      disabled={deleteRegistrationLoading}
                      tone="rose"
                      className="mt-1"
                    >
                      {deleteRegistrationLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      <span className="font-medium">{t("deleteRegistration", "Delete Registration")}</span>
                    </MenuActionItem>
                  )}
                </InlineActionsMenu>
              </div>

              {canChangeRegistrationStatus && (
                <div className="border-t border-slate-100 pt-3">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{t("adminStatusOverride", "Admin Status Override")}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(["registered", "checked-in", "cancelled"] as RegistrationStatus[]).map((statusOption) => {
                      const active = selectedRegistration.status === statusOption;
                      return (
                        <ActionButton
                          key={statusOption}
                          onClick={() => void onUpdateRegistrationStatus(selectedRegistration.id, statusOption)}
                          disabled={statusUpdateLoading}
                          tone={
                            statusOption === "checked-in"
                              ? "emerald"
                              : statusOption === "cancelled"
                              ? "neutral"
                              : "blue"
                          }
                          active={active}
                          className="w-full text-sm"
                        >
                          {statusOption === "registered"
                            ? t("markRegistered", "Mark Registered")
                            : statusOption === "checked-in"
                            ? t("markCheckedIn", "Mark Checked In")
                            : t("markCancelled", "Mark Cancelled")}
                        </ActionButton>
                      );
                    })}
                  </div>
                  {statusUpdateMessage && (
                    <p className={`mt-2 text-xs ${statusUpdateMessage.toLowerCase().includes("failed") || statusUpdateMessage.toLowerCase().includes("error") ? "text-rose-600" : "text-emerald-600"}`}>
                      {statusUpdateMessage}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
