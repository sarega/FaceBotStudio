import { useState } from "react";
import { Bot, Check, Link2, Unlink, Settings, Search } from "lucide-react";
import type { ChannelAccountRecord } from "../../../types";

export function EventChannelAssignments({eventId,channels,eventNames,language,busy,locked,onAssign,onUnassign,onSettings}:{eventId:string;channels:ChannelAccountRecord[];eventNames:Map<string,string>;language:"th"|"en";busy:boolean;locked:boolean;onAssign:(channel:ChannelAccountRecord)=>Promise<boolean>;onUnassign:(channel:ChannelAccountRecord)=>Promise<boolean>;onSettings:()=>void}){
 const t=(th:string,en:string)=>language==="th"?th:en;
 const [query,setQuery]=useState("");const [showLibrary,setShowLibrary]=useState(false);const [feedback,setFeedback]=useState("");
 const ids=(c:ChannelAccountRecord)=>c.event_ids??(c.event_id?[c.event_id]:[]);
 const assigned=channels.filter(c=>ids(c).includes(eventId));
 const available=channels.filter(c=>!ids(c).includes(eventId));
 const visible=available.filter(c=>[c.display_name,c.platform,c.platform_label,...ids(c).map(id=>eventNames.get(id)||id)].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
 async function change(c:ChannelAccountRecord,remove:boolean){
  setFeedback("");
  const ok=await (remove?onUnassign(c):onAssign(c));
  if(ok)setFeedback(t(remove?"นำออกจากอีเวนต์แล้ว":"เชื่อมกับอีเวนต์แล้ว",remove?"Removed from event":"Linked to event"));
  else setFeedback(t("ไม่ได้เปลี่ยนการเชื่อมต่อ กรุณาตรวจข้อความสถานะ","Assignment unchanged. Check the status message."));
 }
 function channelRow(c:ChannelAccountRecord,linked:boolean){
  const other=ids(c).filter(id=>id!==eventId).map(id=>eventNames.get(id)||id);
  const move=c.platform!=="facebook"&&other.length>0;
  return <div key={c.id} className="flex items-center gap-2 border-b border-slate-200 py-2 last:border-b-0">
   <Bot className="size-4 shrink-0 text-slate-500"/>
   <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{c.display_name}</p>
   <p className="text-xs text-slate-500">{c.platform_label||c.platform} · {c.is_active&&c.connection_status==="ready"?t("พร้อมใช้งาน","Ready"):!c.is_active?t("ปิดใช้งาน","Disabled"):t("ตรวจการตั้งค่า","Check setup")}</p>
   {other.length>0&&<p className="text-xs break-words text-slate-500">{t("เชื่อมกับงานอื่น: ","Other events: ")}{other.join(", ")}</p>}</div>
   <button type="button" disabled={busy||(!linked&&locked)} onClick={()=>void change(c,linked)} className="registration-admin-control shrink-0" title={linked?t("นำออกจากอีเวนต์ ไม่ลบบอต","Unlink without deleting bot"):move?t("ย้ายจากอีเวนต์เดิม","Move from existing event"):t("เชื่อมอีเวนต์นี้","Link this event")}>{linked?<Unlink size={14}/>:<Link2 size={14}/>} {linked?t("นำออก","Remove"):move?t("ย้าย","Move"):t("เพิ่ม","Add")}</button>
  </div>;
 }
 return <section className="surface-panel rounded-2xl p-3 sm:p-4 space-y-3">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold"><Bot size={18}/>{t("บอตและช่องทางของอีเวนต์","Assigned bots & channels")} <span className="text-xs text-slate-500">({assigned.length})</span></h3><button type="button" className="registration-admin-control" onClick={onSettings}><Settings size={14}/>{t("ตั้งค่าบอต","Bot settings")}</button></div>
  <p className="text-xs text-slate-500">{t("เลือกบอตที่ตั้งค่าไว้แล้ว การเพิ่มหรือนำออกจะบันทึกทันที ไม่เปลี่ยน API หรือข้อมูลรับรอง","Choose existing connections. Linking and unlinking saves immediately without changing credentials.")}</p>
  {locked&&<p className="text-xs text-amber-700">{t("อีเวนต์นี้ไม่สามารถเพิ่มช่องทางได้","New assignments are locked for this event.")}</p>}
  {assigned.length?assigned.map(c=>channelRow(c,true)):<p className="text-sm text-slate-500">{t("ยังไม่ได้เชื่อมบอตกับอีเวนต์นี้","No bots assigned to this event.")}</p>}
  <button type="button" disabled={locked} onClick={()=>setShowLibrary(v=>!v)} aria-expanded={showLibrary} className="registration-admin-control"><Link2 size={14}/>{t("เลือกบอตจากคลัง","Choose from bot library")} ({available.length})</button>
  {showLibrary&&<div className="rounded-xl border border-slate-200 p-2 space-y-2">
   <div className="flex items-center gap-2"><Search size={15}/><input aria-label={t("ค้นหาบอต","Search bots")} className="w-full rounded border border-slate-300 px-2 py-1 text-sm" value={query} onChange={e=>setQuery(e.target.value)} placeholder={t("ค้นหาชื่อหรือช่องทาง","Search name or platform")}/></div>
   <p className="text-xs text-slate-500">{t("Facebook เชื่อมได้หลายอีเวนต์ ส่วนช่องทางอื่นเชื่อมได้ทีละอีเวนต์ ระบบจะขอยืนยันก่อนย้าย","Facebook supports multiple events. Other channels route to one event; moving requires confirmation.")}</p>
   {visible.length?visible.map(c=>channelRow(c,false)):<p className="text-sm text-slate-500">{t("ไม่พบบอตที่สามารถเพิ่มได้","No available matching bots.")}</p>}
  </div>}
  {feedback&&<p role="status" className="text-xs flex items-center gap-1"><Check size={14}/>{feedback}</p>}
 </section>;
}
