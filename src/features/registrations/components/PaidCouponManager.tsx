import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown, Tag } from "lucide-react";

type Coupon = {
  code: string; kind: "percent" | "fixed" | "free"; value_minor: number;
  max_uses: number | null; per_customer_limit: number | null;
  starts_ms: number | null; ends_ms: number | null; enabled: number; uses: number;
};
type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const money = new Intl.NumberFormat("th-TH", {style:"currency",currency:"THB"});
const dt = (value:number|null) => value==null ? "" :
  new Date(value-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16);
function blank(): Coupon {
  return {code:"",kind:"percent",value_minor:2000,max_uses:null,per_customer_limit:1,
    starts_ms:null,ends_ms:null,enabled:1,uses:0};
}
export function PaidCouponManager({eventId,apiFetch}:{eventId:string;apiFetch:ApiFetch}) {
  const [open,setOpen]=useState(false);
  const [coupons,setCoupons]=useState<Coupon[]>([]);
  const [editing,setEditing]=useState<Coupon>(blank);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const path="/api/events/"+encodeURIComponent(eventId)+"/paid-registration/coupons";
  async function load() {
    try {
      const response=await apiFetch(path);
      const payload=await response.json();
      if(!response.ok) throw new Error(payload.error||"Could not load coupons");
      setCoupons(payload.coupons||[]);setError("");
    } catch(e) {setError(e instanceof Error?e.message:"Coupons unavailable");}
  }
  useEffect(()=>{if(open) void load();},[open,eventId]);
  async function save(event:FormEvent) {
    event.preventDefault();if(busy)return;setBusy(true);setError("");setMessage("");
    try {
      const response=await apiFetch(path,{method:"PUT",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({code:editing.code.trim().toUpperCase(),kind:editing.kind,
          value_minor:editing.kind==="free"?0:editing.value_minor,
          max_uses:editing.max_uses,per_customer_limit:editing.per_customer_limit,
          starts_ms:editing.starts_ms,ends_ms:editing.ends_ms,enabled:!!editing.enabled})});
      const payload=await response.json();
      if(!response.ok) throw new Error(payload.error||"Could not save coupon");
      setMessage("บันทึกคูปองแล้ว / Coupon saved");
      await load();
    } catch(e) {setError(e instanceof Error?e.message:"Coupon save failed");}
    finally {setBusy(false);}
  }
  const input="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
  return <section className="rounded-xl border border-slate-200 bg-white p-4 text-slate-900 shadow-sm">
    <button type="button" onClick={()=>setOpen(!open)} aria-expanded={open}
      className="flex w-full items-center justify-between gap-3 text-left font-semibold">
      <span className="flex items-center gap-2"><Tag className="h-5 w-5 text-blue-600"/>
        Coupons & Promotions / คูปองและโปรโมชัน</span>
      <ChevronDown className={"h-5 w-5 transition-transform "+(open?"rotate-180":"")}/>
    </button>
    {open && <div className="mt-4 space-y-4">
      <p className="text-sm text-slate-600">One coupon per booking. Discounts apply after accommodation adjustments.
        Expired unpaid bookings release their usage quota automatically.</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {coupons.map(c=><button type="button" key={c.code} onClick={()=>{setEditing({...c});setMessage("");}}
          className="rounded-lg border border-slate-200 p-3 text-left text-sm hover:border-blue-500">
          <span className="font-bold">{c.code}</span>
          <span className="ml-2 text-slate-500">{c.kind==="free"?"FREE":
            c.kind==="percent"?(c.value_minor/100)+"%":money.format(c.value_minor/100)}</span>
          <p className="mt-1 text-xs text-slate-600">{c.uses} / {c.max_uses??"∞"} uses
            · {c.enabled?"Active":"Disabled"}</p>
        </button>)}
      </div>
      <button type="button" onClick={()=>{setEditing(blank());setMessage("");}}
        className="rounded-lg border border-blue-300 px-3 py-2 text-sm font-semibold text-blue-700">
        + New coupon / เพิ่มคูปอง
      </button>
      <form onSubmit={save} className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Coupon code
          <input className={input} required maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}"
            placeholder="SPECIAL20" value={editing.code}
            onChange={e=>setEditing({...editing,code:e.target.value.toUpperCase()})}/>
        </label>
        <label className="text-sm font-medium">Discount type
          <select className={input} value={editing.kind}
            onChange={e=>setEditing({...editing,kind:e.target.value as Coupon["kind"]})}>
            <option value="percent">Percentage (%)</option>
            <option value="fixed">Fixed amount (THB)</option>
            <option value="free">100% Free</option>
          </select>
        </label>
        {editing.kind!=="free"&&<label className="text-sm font-medium">
          {editing.kind==="percent"?"Discount (%)":"Amount (THB)"}
          <input className={input} type="number" min={editing.kind==="percent"?"0.01":"0.01"}
            max={editing.kind==="percent"?100:undefined} step="0.01"
            value={editing.kind==="percent"?editing.value_minor/100:editing.value_minor/100}
            onChange={e=>setEditing({...editing,value_minor:Math.round(Number(e.target.value)*100)})}/>
        </label>}
        <label className="text-sm font-medium">Maximum uses (blank = unlimited)
          <input className={input} type="number" min={1} step={1} value={editing.max_uses??""}
            onChange={e=>setEditing({...editing,max_uses:e.target.value===""?null:Number(e.target.value)})}/>
        </label>
        <label className="text-sm font-medium">Uses per account (blank = unlimited)
          <input className={input} type="number" min={1} step={1} value={editing.per_customer_limit??""}
            onChange={e=>setEditing({...editing,per_customer_limit:e.target.value===""?null:Number(e.target.value)})}/>
        </label>
        <label className="text-sm font-medium">Start date (optional)
          <input className={input} type="datetime-local" value={dt(editing.starts_ms)}
            onChange={e=>setEditing({...editing,starts_ms:e.target.value?new Date(e.target.value).getTime():null})}/>
        </label>
        <label className="text-sm font-medium">End date (optional)
          <input className={input} type="datetime-local" value={dt(editing.ends_ms)}
            onChange={e=>setEditing({...editing,ends_ms:e.target.value?new Date(e.target.value).getTime():null})}/>
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={!!editing.enabled}
            onChange={e=>setEditing({...editing,enabled:e.target.checked?1:0})}/>
          Active / เปิดใช้งาน
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button disabled={busy} className="min-h-10 rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white disabled:opacity-50">
            {busy?"Saving…":"Save coupon"}
          </button>
          {message&&<span role="status" className="text-sm text-emerald-700">{message}</span>}
          {error&&<span role="alert" className="text-sm text-red-700">{error}</span>}
        </div>
      </form>
    </div>}
  </section>;
}
