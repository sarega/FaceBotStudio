import { useState, useEffect, useRef } from "react";
import type { Settings } from "../../../types";
import { TRANSLATABLE_EVENT_FIELDS, extractEventContent, parseEventLocalizations, normalizeLocale, eventContentFingerprint, type EventTranslationField } from "../../../lib/eventLocalization";
const labels:Record<string,string>={event_name:"Event name",event_public_summary:"Public summary",event_description:"Description (HTML)",event_venue_name:"Venue",event_room_detail:"Room",event_location:"Address",event_travel:"Travel information",event_recurring_schedule:"Recurring schedule",event_public_cta_label:"Action button",event_public_success_message:"Success message",event_public_privacy_label:"Privacy label",event_public_privacy_text:"Privacy text",event_public_contact_intro:"Contact introduction",event_public_contact_hours:"Contact hours"};
export function EventLocalizationPanel({settings,onChange,apiFetch,eventId}:{settings:Settings;onChange:(patch:Partial<Settings>)=>void;apiFetch?:(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;eventId:string}) {
 const [target,setTarget]=useState("en");const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const primary=normalizeLocale(settings.event_content_language);
 const locale=normalizeLocale(target);
 const translations=parseEventLocalizations(settings.event_translations_json);
 const current=translations[locale];
 const source=extractEventContent({...settings});
 const fingerprint=eventContentFingerprint(source);
 const stale=!!current&&current.sourceFingerprint!==fingerprint;
 const update=(next:typeof current)=>onChange({event_translations_json:JSON.stringify({...translations,[locale]:next})});
 const edit=(field:EventTranslationField,value:string)=>update({fields:{...current?.fields,[field]:value},sourceFingerprint:current?.sourceFingerprint||fingerprint,published:false});
 const translate=async()=>{
   if(!apiFetch||!primary||!locale||locale===primary)return;
   if(current&&Object.values(current.fields).some(Boolean)&&!window.confirm("Replace existing translation with a new AI draft?"))return;
   setBusy(true);setMessage("");
   try{
     const res=await apiFetch("/api/events/"+encodeURIComponent(eventId)+"/translate-content",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({source:primary,target:locale,fields:source})});
     const data=await res.json();if(!res.ok)throw Error(data.error||"Translation failed");
     if(!mounted.current)return;
     update({fields:data.fields,sourceFingerprint:data.sourceFingerprint,published:false});setMessage("AI draft ready. Review and publish, then Save Publishing.");
   }catch(error){if(mounted.current)setMessage(String(error));}finally{if(mounted.current)setBusy(false);}
 };
 return <section className="md:col-span-2 rounded-xl border border-slate-200 bg-white p-4 space-y-3">
   <h3 className="font-semibold">Multilingual Event Content</h3>
   <p className="text-xs text-slate-500">Write the original once, translate with AI, review, then publish. Save Event Setup first after changing the original name or description. Existing content is always the fallback. Public language switch supports Thai and English.</p>
   <div className="grid gap-2 sm:grid-cols-2">
     <label className="text-xs">Original language<select value={primary} disabled={busy} onChange={e=>{onChange({event_content_language:e.target.value});if(target===e.target.value)setTarget(e.target.value==="th"?"en":"th");}} className="block w-full rounded-lg border p-2 text-sm"><option value="">Choose original language</option><option value="th">ไทย</option><option value="en">English</option>{primary&&!["th","en"].includes(primary)&&<option value={primary}>{primary}</option>}</select></label>
     <label className="text-xs">Translation language<select value={target} disabled={busy} onChange={e=>{setTarget(e.target.value);setMessage("");}} className="block w-full rounded-lg border p-2 text-sm"><option value="en">English</option><option value="th">ไทย</option><option value="zh">中文 (prepared)</option><option value="ja">日本語 (prepared)</option><option value="fr">Français (prepared)</option></select></label>
   </div>
   {primary&&locale!==primary&&<><div className="flex flex-wrap gap-2 items-center"><button type="button" disabled={busy||!apiFetch||!eventId} onClick={()=>void translate()} className="rounded-lg bg-blue-600 px-3 py-2 text-xs text-white disabled:opacity-50">{busy?"Translating…":"Generate AI translation"}</button><span className="text-xs">{stale?"Source changed — review translation":current?.published?"Published (save to apply)":current?"Draft":"Not translated"}</span></div>
   <details open={!!current} className="space-y-3"><summary className="cursor-pointer text-sm font-medium">Review / manually edit translation</summary>{TRANSLATABLE_EVENT_FIELDS.filter(key=>source[key]?.trim()).map(key=><label key={key} className="block text-xs font-medium">{labels[key]}<span className="block whitespace-pre-wrap text-slate-500 font-normal max-h-24 overflow-auto">{source[key]}</span><textarea disabled={busy} value={current?.fields[key]||""} onChange={e=>edit(key,e.target.value)} rows={key==="event_description"?8:2} className="block w-full rounded-lg border p-2 font-normal text-sm" /></label>)}</details>
   {current&&<div className="flex flex-wrap gap-2"><button type="button" disabled={busy||!Object.values(current.fields).some(v=>v.trim())} onClick={()=>{update({...current,sourceFingerprint:fingerprint,published:true});setMessage("Translation marked published. Save Publishing to apply.");}} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs text-white">Approve & publish translation</button><button type="button" disabled={busy} onClick={()=>update({...current,published:false})} className="rounded-lg border px-3 py-2 text-xs">Unpublish translation</button></div>}</>}
   {message&&<p role="status" className="text-xs text-slate-600">{message}</p>}
 </section>;
}
