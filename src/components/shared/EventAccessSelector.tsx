import { useMemo, useState, useEffect } from "react";
import type { EventRecord } from "../../types";
import { EVENT_FILTERS, eventMatchesFilter, eventMatchesText, type EventFilter } from "../../lib/eventFilters";
const PAGE_SIZE = 15;
export function EventAccessSelector({ events, selectedIds, onChange, disabled = false, preferenceKey, single = false }: {
  events: EventRecord[]; selectedIds: string[]; onChange: (ids:string[])=>void; disabled?:boolean; preferenceKey?:string; single?:boolean;
}) {
  const [filter,setFilter] = useState<EventFilter>("current");
  useEffect(()=>{ if(!preferenceKey)return; try { const saved=localStorage.getItem(preferenceKey); if(EVENT_FILTERS.some(f=>f.id===saved)) setFilter(saved as EventFilter); } catch {} },[preferenceKey]);
  const changeFilter=(id:EventFilter)=>{setFilter(id);setPage(0);if(preferenceKey)try{localStorage.setItem(preferenceKey,id);}catch{}};
  const [query,setQuery] = useState("");
  const [page,setPage] = useState(0);
  const selected = useMemo(()=>new Set(selectedIds),[selectedIds]);
  const matched = useMemo(()=>events.filter(e=>eventMatchesFilter(e,filter,selectedIds)&&eventMatchesText(e,query)).sort((a,b)=>a.name.localeCompare(b.name)),[events,filter,selectedIds,query]);
  const last = Math.max(0,Math.ceil(matched.length/PAGE_SIZE)-1);
  const current = Math.min(page,last);
  const toggle = (id:string) => onChange(single?[id]:selected.has(id)?selectedIds.filter(v=>v!==id):[...selectedIds,id]);
  return <div className="mt-3 space-y-2">
    <div className="flex flex-wrap gap-1">
      {(["current","past","archived","all","assigned"] as EventFilter[]).map(id=><button key={id} type="button" aria-pressed={filter===id} onClick={()=>changeFilter(id)} className={`rounded-lg border px-2 py-1 text-xs ${filter===id?"border-blue-500 bg-blue-50 font-semibold text-blue-700":"border-slate-200"}`}>{EVENT_FILTERS.find(v=>v.id===id)?.label}{id==="assigned"?` (${selectedIds.length})`:""}</button>)}
    </div>
    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
      <input aria-label="Search events" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder="Search name, organizer, slug..." className="min-w-0 rounded-lg border p-2 text-xs"/>
      <select aria-label="Filter event status" value={filter} onChange={e=>changeFilter(e.target.value as EventFilter)} className="rounded-lg border p-2 text-xs">{EVENT_FILTERS.map(f=><option key={f.id} value={f.id}>{f.label}</option>)}</select>
    </div>
    <p className="text-xs text-slate-500">{selectedIds.length} selected · {matched.length} matching events · filters do not change assignments</p>
    <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 divide-y">
      {matched.slice(current*PAGE_SIZE,(current+1)*PAGE_SIZE).map(e=><label key={e.id} className="flex items-start gap-2 p-2 text-xs">
        <input type={single?"radio":"checkbox"} checked={selected.has(e.id)} onChange={()=>toggle(e.id)} disabled={disabled} className="mt-0.5 accent-blue-600"/>
        <span className="min-w-0 flex-1"><span className="block font-medium">{e.name}</span><span className="text-slate-500">{e.event_type==="campaign"?"Campaign":e.event_type==="recurring"?"Recurring":"Event"} · {e.event_date?.slice(0,10)||"No date"}</span></span>
        <span className="text-slate-500">{e.effective_status==="active"?"Live":e.effective_status==="closed"?"Completed":e.effective_status}</span>
      </label>)}
      {!matched.length&&<p className="p-3 text-xs text-slate-500">No matching events.</p>}
    </div>
    {last>0&&<div className="flex items-center justify-between text-xs"><button type="button" disabled={current===0} onClick={()=>setPage(current-1)}>Previous</button><span>Page {current+1} / {last+1}</span><button type="button" disabled={current===last} onClick={()=>setPage(current+1)}>Next</button></div>}
    {!single&&selectedIds.length>0&&<details className="rounded-lg border p-2 text-xs"><summary className="cursor-pointer font-medium">Assigned events ({selectedIds.length})</summary><div className="mt-2 max-h-40 overflow-y-auto space-y-1">{selectedIds.map(id=><div key={id} className="flex items-center justify-between gap-2"><span>{events.find(e=>e.id===id)?.name||id}</span><button type="button" disabled={disabled} onClick={()=>toggle(id)} aria-label="Remove assignment" className="text-slate-500">×</button></div>)}</div></details>}
  </div>;
}
