import { useEffect, useState, type FormEvent } from "react";
import { RegistrationSectionHeader } from "./RegistrationSectionHeader";

type Coupon = {
  code: string; kind: "percent" | "fixed" | "free"; value_minor: number;
  max_uses: number | null; per_customer_limit: number | null;
  starts_ms: number | null; ends_ms: number | null; enabled: number; uses: number;
  availability?: "active" | "disabled" | "scheduled" | "expired" | "exhausted"; server_now_ms?:number;
};
type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const money = new Intl.NumberFormat("th-TH", {style:"currency",currency:"THB"});
// PostgreSQL returns BIGINT timestamps as strings. new Date("176...") is Invalid Date.
export function couponDateInput(value: number | string | null | undefined) {
  if (value == null || value === "") return "";
  const epoch = Number(value);
  if (!Number.isFinite(epoch)) return "";
  const date = new Date(epoch);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(epoch-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function blank(): Coupon {
  return {code:"",kind:"percent",value_minor:2000,max_uses:null,per_customer_limit:1,
    starts_ms:null,ends_ms:null,enabled:1,uses:0};
}
export function PaidCouponManager({eventId,apiFetch}:{eventId:string;apiFetch:ApiFetch}) {
  const [open,setOpen]=useState(false);
  const [coupons,setCoupons]=useState<Coupon[]>([]);
  const [configuredEvent,setConfiguredEvent]=useState<{id:string;slug:string;name:string;publicPageEnabled:boolean}|null>(null);
  const [editing,setEditing]=useState<Coupon>(blank);
  const [editingCode,setEditingCode]=useState<string|null>(null);
  const [deleting,setDeleting]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const path="/api/events/"+encodeURIComponent(eventId)+"/paid-registration/coupons";
  async function load() {
    try {
      const response=await apiFetch(path);
      const payload=await response.json();
      if(!response.ok) throw new Error(payload.error||"Could not load coupons");
      setCoupons(payload.coupons||[]);
      setConfiguredEvent(payload.event_id&&payload.event_slug?
        {id:payload.event_id,slug:payload.event_slug,
          name:payload.event_name||payload.event_slug,
          publicPageEnabled:payload.public_page_enabled===true}:null);
      setError("");
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
      setEditingCode(String(payload.coupon?.code||editing.code).toUpperCase());
      setMessage("บันทึกคูปองแล้ว / Coupon saved");
      await load();
    } catch(e) {setError(e instanceof Error?e.message:"Coupon save failed");}
    finally {setBusy(false);}
  }
  function edit(coupon:Coupon) {
    setEditing({...coupon,
      value_minor:Number(coupon.value_minor),
      starts_ms:coupon.starts_ms==null?null:Number(coupon.starts_ms),
      ends_ms:coupon.ends_ms==null?null:Number(coupon.ends_ms),
      enabled:Number(coupon.enabled),
      uses:Number(coupon.uses),
    });
    setEditingCode(coupon.code);setError("");setMessage("");
  }
  function duplicate(coupon:Coupon) {
    setEditing({...coupon,code:"",uses:0,enabled:1,
      value_minor:Number(coupon.value_minor),
      starts_ms:coupon.starts_ms==null?null:Number(coupon.starts_ms),
      ends_ms:coupon.ends_ms==null?null:Number(coupon.ends_ms),
    });
    setEditingCode(null);setError("");setMessage("Copied settings. Enter a new coupon code.");
  }
  async function removeCoupon(coupon:Coupon) {
    if(busy || deleting || !window.confirm(
      "Delete coupon "+coupon.code+"? This cannot be undone.\nลบคูปอง "+coupon.code+" อย่างถาวรหรือไม่?")) return;
    setDeleting(coupon.code);setError("");setMessage("");
    try {
      const response=await apiFetch(path+"/"+encodeURIComponent(coupon.code),{method:"DELETE"});
      const payload=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(payload.error||"coupon_delete_failed");
      if(editingCode===coupon.code){setEditing(blank());setEditingCode(null);}
      await load();setMessage("Deleted "+coupon.code);
    }catch(e) {
      const errorCode=e instanceof Error?e.message:"";
      setError(errorCode==="coupon_has_history"
        ? "คูปองนี้มีประวัติการใช้แล้ว ลบไม่ได้ ให้ปิด Active แทน / This coupon has booking history. Disable it instead."
        : "ลบคูปองไม่สำเร็จ / Could not delete coupon: "+errorCode);
    }finally{setDeleting(null);}
  }
  const input="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
  return <section className="registration-admin-section registration-admin-coupons">
    <RegistrationSectionHeader tone="coupons" title="Coupons & Promotions"
      subtitle="คูปอง · โปรโมชันและส่วนลด" open={open} onToggle={()=>setOpen(!open)} />
    {open && <div className="registration-section-content space-y-4">
      <p className="text-sm text-slate-600">One coupon per booking. Discounts apply after accommodation adjustments.
        Expired unpaid bookings release their usage quota automatically.</p>
      {configuredEvent&&<div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
        <p className="font-semibold">คูปองสำหรับ Event: {configuredEvent.name}</p>
        <p className="mt-1">Public slug: <code>{configuredEvent.slug}</code>
          <span className="ml-2 font-mono text-[10px] opacity-70">ID: {configuredEvent.id}</span>
        </p>
        {configuredEvent.publicPageEnabled ?
          <a className="mt-2 inline-flex rounded-md border border-blue-300 px-3 py-2 font-semibold underline"
            href={"/events/"+encodeURIComponent(configuredEvent.slug)}
            target="_blank" rel="noopener noreferrer">
            เปิดหน้า Event นี้ / Open this Event
          </a> :
          <p className="mt-2 font-semibold text-amber-800">
            Public Event page is disabled. Enable its public page in Event Settings before sharing a registration link.
          </p>}
      </div>}
      <div className="paid-coupon-grid grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {coupons.map(c=><div key={c.code} className={"space-y-2 rounded-lg border p-3 text-sm " +
          (editingCode===c.code?"paid-coupon-selected border-blue-500":"border-slate-200")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold break-all">{c.code}</span>
            <span className="text-slate-600">{c.kind==="free"?"FREE":
              c.kind==="percent"?(Number(c.value_minor)/100)+"%":money.format(Number(c.value_minor)/100)}</span>
          </div>
          <p className="text-xs text-slate-600">{Number(c.uses)} / {c.max_uses??"∞"} uses
            · {c.availability === "active" ? "Ready to use" :
              c.availability === "scheduled" ? "Not started" :
              c.availability === "expired" ? "Expired" :
              c.availability === "exhausted" ? "Fully used" :
              c.availability === "disabled" ? "Disabled" :
              Number(c.enabled)===1 ? "Active" : "Disabled"}</p>
          {c.availability === "scheduled" && <p className="text-xs text-amber-700">
            Starts {new Date(Number(c.starts_ms)).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})} Bangkok
          </p>}
          {c.availability === "expired" && <p className="text-xs text-red-700">
            Ended {new Date(Number(c.ends_ms)).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})} Bangkok
          </p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={()=>edit(c)} className="rounded-md border border-blue-300 px-2.5 py-2 font-semibold text-blue-700">
              Edit
            </button>
            <button type="button" onClick={()=>duplicate(c)} className="rounded-md border border-slate-300 px-2.5 py-2 font-semibold text-slate-700">
              Duplicate
            </button>
            <button type="button" disabled={!!deleting||busy} onClick={()=>void removeCoupon(c)}
              className="rounded-md border border-red-300 px-2.5 py-2 font-semibold text-red-700 disabled:opacity-50">
              {deleting===c.code?"Deleting…":"Delete"}
            </button>
          </div>
        </div>)}
      </div>
      <button type="button" onClick={()=>{setEditing(blank());setEditingCode(null);setError("");setMessage("");}}
        className="rounded-lg border border-blue-300 px-3 py-2 text-sm font-semibold text-blue-700">
        + New coupon / เพิ่มคูปอง
      </button>
      {editingCode&&<p className="text-sm font-semibold text-blue-700">
        Editing / กำลังแก้ไข: {editingCode}
      </p>}
      <form onSubmit={save} className="paid-coupon-form grid gap-3 rounded-xl p-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Coupon code
          <input className={input} required maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}"
            readOnly={editingCode!==null} aria-readonly={editingCode!==null}
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
          <input className={input} type="datetime-local" value={couponDateInput(editing.starts_ms)}
            onChange={e=>setEditing({...editing,starts_ms:e.target.value?new Date(e.target.value).getTime():null})}/>
        </label>
        <label className="text-sm font-medium">End date (optional)
          <input className={input} type="datetime-local" value={couponDateInput(editing.ends_ms)}
            onChange={e=>setEditing({...editing,ends_ms:e.target.value?new Date(e.target.value).getTime():null})}/>
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={!!editing.enabled}
            onChange={e=>setEditing({...editing,enabled:e.target.checked?1:0})}/>
          Active / เปิดใช้งาน
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button disabled={busy} className="min-h-10 rounded-lg bg-blue-600 px-5 py-2 font-semibold text-white disabled:opacity-50">
            {busy?"Saving…":editingCode?"Save changes / บันทึกการแก้ไข":"Create coupon / สร้างคูปอง"}
          </button>
          {message&&<span role="status" className="text-sm text-emerald-700">{message}</span>}
          {error&&<span role="alert" className="text-sm text-red-700">{error}</span>}
        </div>
      </form>
    </div>}
  </section>;
}
