import { useEffect, useMemo, useState, type FormEvent } from "react";

type Performance = { id: string; code: string; title: string; starts_at: string; seat_plan_image_url: string | null };
type Seat = { id: string; performance_id: string; zone: string; row_label: string; seat_label: string; face_value: number | null; x: number | null; y: number | null; status: string };
type Order = { id: string; payment_status: string; status: string; hold_expires_at: string | null; rejection_reason: string | null; price_amount: number; performance_title?: string; performance_starts_at?: string; zone?: string; row_label?: string; seat_label?: string; delivery?: { png_url: string; pdf_url: string } | null };
type Setup = { performances: Performance[]; seats: Seat[]; receiver_name: string; promptpay_ready: boolean; hold_minutes: number };

const money = (value: number) => new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(value);

export function PublicDirectTicketPanel({ slug }: { slug: string }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [performanceId, setPerformanceId] = useState("");
  const [seatId, setSeatId] = useState("");
  const [form, setForm] = useState({ buyer_name: "", phone: "", email: "" });
  const [order, setOrder] = useState<Order | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refreshSetup = async () => {
    const response = await fetch(`/api/public/events/${encodeURIComponent(slug)}/direct-ticketing`);
    if (!response.ok) return;
    const data = await response.json() as Setup;
    setSetup(data);
    setPerformanceId((current) => current || data.performances[0]?.id || "");
  };

  useEffect(() => { void refreshSetup(); }, [slug]);

  const refreshOrder = async () => {
    if (!order?.id || !accessToken) return;
    const response = await fetch(`/api/public/direct-orders/${encodeURIComponent(order.id)}?token=${encodeURIComponent(accessToken)}`);
    if (!response.ok) return;
    const data = await response.json() as { order: Order };
    setOrder(data.order);
  };

  useEffect(() => {
    if (!order || !["held", "issued"].includes(order.status)) return;
    const timer = window.setInterval(() => void refreshOrder(), 10000);
    return () => window.clearInterval(timer);
  }, [order?.id, order?.status, accessToken]);

  const seats = useMemo(() => setup?.seats.filter((seat) => seat.performance_id === performanceId) || [], [setup, performanceId]);
  const performance = setup?.performances.find((item) => item.id === performanceId);
  const selectedSeat = seats.find((seat) => seat.id === seatId);
  const mappedSeats = Boolean(performance?.seat_plan_image_url && seats.some((seat) => seat.x != null && seat.y != null));

  const reserve = async (event: FormEvent) => {
    event.preventDefault();
    if (!seatId) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/public/events/${encodeURIComponent(slug)}/direct-orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ performance_id: performanceId, seat_id: seatId, ...form }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "จองที่นั่งไม่สำเร็จ");
      setOrder(data.order); setAccessToken(data.access_token); await refreshSetup();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "จองที่นั่งไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  const uploadProof = async () => {
    if (!proof || !order || !accessToken) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/public/direct-orders/${encodeURIComponent(order.id)}/payment-proof?token=${encodeURIComponent(accessToken)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Proof-Mime": proof.type, "X-Payment-Reference": paymentReference }, body: proof });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "ส่งหลักฐานไม่สำเร็จ");
      setOrder(data.order); setProof(null); setMessage("ส่งหลักฐานแล้ว เจ้าหน้าที่จะตรวจสอบกับบัญชีรับเงินจริงก่อนออกบัตร");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ส่งหลักฐานไม่สำเร็จ");
    } finally { setBusy(false); }
  };

  if (!setup?.performances.length || !setup.seats.length) return null;

  return (
    <section id="direct-seat-tickets" className="py-4">
      <div className="surface-panel rounded-[1.75rem] p-4 sm:p-5">
        <p className="text-[10px] font-bold uppercase tracking-[.18em] text-violet-600">Direct allocation</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">เลือกที่นั่ง VIP / ราคาพิเศษ</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">แสดงเฉพาะที่นั่งที่ผู้จัดล็อกออกจาก Ticketmelon แล้วเท่านั้น</p>

        {message && <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-700">{message}</p>}

        {!order ? (
          <form onSubmit={reserve} className="mt-4 space-y-4">
            <label className="block text-sm font-semibold text-slate-700">รอบการแสดง
              <select value={performanceId} onChange={(event) => { setPerformanceId(event.target.value); setSeatId(""); }} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5">
                {setup.performances.map((item) => <option key={item.id} value={item.id}>{item.title} — {new Date(item.starts_at).toLocaleString("th-TH")}</option>)}
              </select>
            </label>

            {mappedSeats ? (
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                <img src={performance?.seat_plan_image_url || ""} alt="Seat plan" className="h-full w-full object-contain" />
                {seats.filter((seat) => seat.x != null && seat.y != null).map((seat) => <button key={seat.id} type="button" disabled={seat.status !== "available"} title={`${seat.zone} ${seat.row_label}-${seat.seat_label}`} onClick={() => setSeatId(seat.id)} style={{ left: `${seat.x}%`, top: `${seat.y}%` }} className={`absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border text-[9px] font-bold ${seatId === seat.id ? "border-violet-800 bg-violet-600 text-white" : seat.status === "available" ? "border-emerald-700 bg-emerald-500 text-white" : "border-slate-400 bg-slate-300 text-slate-500"}`}>{seat.seat_label}</button>)}
              </div>
            ) : (
              <div className="flex max-h-64 flex-wrap gap-2 overflow-auto rounded-xl border border-slate-200 p-3">
                {seats.map((seat) => <button key={seat.id} type="button" disabled={seat.status !== "available"} onClick={() => setSeatId(seat.id)} className={`rounded-lg border px-3 py-2 text-xs font-bold ${seatId === seat.id ? "border-violet-700 bg-violet-600 text-white" : seat.status === "available" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-100 text-slate-400"}`}>{seat.zone} {seat.row_label}-{seat.seat_label}</button>)}
              </div>
            )}

            {selectedSeat && <p className="rounded-xl bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-900">ที่นั่ง {selectedSeat.zone} แถว {selectedSeat.row_label} เลข {selectedSeat.seat_label} · {money(Number(selectedSeat.face_value || 0))}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <input required placeholder="ชื่อผู้รับบัตร" value={form.buyer_name} onChange={(event) => setForm({ ...form, buyer_name: event.target.value })} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
              <input required placeholder="เบอร์โทร" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
              <input type="email" placeholder="อีเมล (ถ้ามี)" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm sm:col-span-2" />
            </div>
            <button disabled={busy || !seatId} className="w-full rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">ล็อกที่นั่ง {setup.hold_minutes} นาที</button>
          </form>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-slate-200 p-3 text-sm">
              <p className="font-bold text-slate-900">{order.performance_title}</p>
              <p className="mt-1">โซน {order.zone} · แถว {order.row_label} · ที่นั่ง {order.seat_label}</p>
              <p className="mt-1 text-lg font-bold text-violet-800">{money(order.price_amount)}</p>
              {order.hold_expires_at && order.status === "held" && <p className="mt-1 text-rose-700">ชำระและส่งหลักฐานภายใน {new Date(order.hold_expires_at).toLocaleString("th-TH")}</p>}
            </div>

            {order.status === "held" && (
              <>
                {setup.promptpay_ready ? <img src={`/api/public/direct-orders/${encodeURIComponent(order.id)}/payment-qr?token=${encodeURIComponent(accessToken)}`} alt="PromptPay QR" className="mx-auto w-full max-w-64 rounded-xl border border-slate-200" /> : <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">ผู้จัดยังไม่ได้ตั้งค่า PromptPay</p>}
                {setup.receiver_name && <p className="text-center text-sm">ผู้รับเงิน: <strong>{setup.receiver_name}</strong></p>}
                <input placeholder="เลขอ้างอิงจากสลิป (ถ้ามี)" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setProof(event.target.files?.[0] || null)} className="block w-full text-sm" />
                <button type="button" disabled={busy || !proof} onClick={() => void uploadProof()} className="w-full rounded-xl bg-violet-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">ส่งหลักฐานการชำระเงิน</button>
                <button type="button" onClick={() => void refreshOrder()} className="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">ตรวจสอบสถานะ</button>
              </>
            )}
            {order.payment_status === "proof_submitted" && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">ได้รับหลักฐานแล้ว กำลังรอเจ้าหน้าที่ตรวจยอดเงินจริง ระบบยังไม่ออกบัตรในขั้นตอนนี้</p>}
            {order.status === "issued" && order.delivery && <div className="rounded-xl bg-emerald-50 p-3 text-center"><p className="font-bold text-emerald-900">ชำระเงินผ่านแล้ว บัตรพร้อมใช้งาน</p><div className="mt-3 flex justify-center gap-2"><a href={order.delivery.png_url} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white">เปิดบัตร PNG</a><a href={order.delivery.pdf_url} target="_blank" rel="noreferrer" className="rounded-lg border border-emerald-700 px-4 py-2 text-sm font-bold text-emerald-800">A6 PDF</a></div></div>}
            {order.payment_status === "rejected" && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900">ไม่ผ่านการตรวจสอบ: {order.rejection_reason || "กรุณาติดต่อผู้จัดงาน"}</p>}
            {order.payment_status === "expired" && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900">หมดเวลาล็อกที่นั่งแล้ว หากชำระไปแล้วกรุณาติดต่อผู้จัดงานพร้อมเลขคำสั่งซื้อ {order.id}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
