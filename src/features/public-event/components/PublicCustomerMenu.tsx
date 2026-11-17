import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, LogOut, Ticket, UserRound } from "lucide-react";
import { customerApi, type CustomerAccount } from "../../customer-account/components/CustomerAccountScreen";

/** Customer-only navigation. Never mixes staff/admin and attendee authentication. */
export function PublicCustomerMenu({ compact = false }: { compact?: boolean }) {
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let sequence = 0;
    async function refresh() {
      const current = ++sequence;
      try {
        const result = await customerApi<{ account: CustomerAccount }>("/api/customer/account/me", {
          signal: controller.signal,
        });
        if (!controller.signal.aborted && current === sequence) setAccount(result.account);
      } catch {
        if (!controller.signal.aborted && current === sequence) {
          setAccount(null);
          setOpen(false);
        }
      } finally {
        if (!controller.signal.aborted && current === sequence) setLoading(false);
      }
    }
    void refresh();
    const focus = () => { void refresh(); };
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await customerApi("/api/customer/account/logout", { method: "POST" });
      setAccount(null);
      setOpen(false);
      // Other account-aware widgets must not keep displaying the stale signed-in session.
      window.dispatchEvent(new Event("customer-session-changed"));
    } catch {
      // Do not incorrectly claim a logout when the server rejected it.
      setOpen(false);
      window.location.assign("/account");
    } finally {
      setSigningOut(false);
    }
  }

  const initials = [account?.first_name, account?.last_name]
    .filter(Boolean).map(name => name!.trim()[0]).join("").slice(0, 2).toLocaleUpperCase();
  return (
    <div className="public-customer-menu relative z-50" ref={root}>
      {loading ? (
        <span className="block h-10 w-24 animate-pulse rounded-full bg-slate-200/50" aria-label="Checking account" />
      ) : !account ? (
        <div className="flex items-center gap-2">
          <a href="/account/register" className="public-customer-guest-link rounded-lg px-2 py-2 text-xs font-semibold sm:text-sm">สมัคร<span className={compact ? "hidden sm:inline" : undefined}> / Register</span></a>
          <a href="/account/login" className="public-customer-signin rounded-lg px-3 py-2 text-xs font-semibold sm:text-sm">เข้าสู่ระบบ<span className={compact ? "hidden sm:inline" : undefined}> / Sign in</span></a>
        </div>
      ) : (
        <>
          <button type="button" aria-label="บัญชีของฉัน / My account" aria-haspopup="menu" aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="public-customer-trigger flex items-center gap-2 rounded-full border px-2 py-1.5 text-sm font-semibold">
            <span className="public-customer-avatar flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">
              {initials || <UserRound className="h-4 w-4" />}
            </span>
            <span className="hidden max-w-32 truncate sm:inline">{account.first_name || account.email}</span>
            <ChevronDown className="h-4 w-4" />
          </button>
          {open && (
            <div role="menu" aria-label="My account" className="public-customer-dropdown absolute right-0 top-[calc(100%+0.5rem)] w-64 rounded-xl border p-2 shadow-xl">
              <div className="border-b border-current/10 px-3 py-2">
                <p className="truncate text-sm font-semibold">{account.first_name} {account.last_name}</p>
                <p className="truncate text-xs opacity-75">{account.email}</p>
              </div>
              <a role="menuitem" href="/account" className="public-customer-item flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm">
                <UserRound className="h-4 w-4" /> โปรไฟล์ / Profile
              </a>
              <a role="menuitem" href="/app/orders" className="public-customer-item flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm">
                <Ticket className="h-4 w-4" /> การจอง / My Bookings
              </a>
              <a role="menuitem" href="/events" className="public-customer-item flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm">
                <CalendarDays className="h-4 w-4" /> ดูงาน / Browse Events
              </a>
              <div className="my-1 border-t border-current/10" />
              <button type="button" role="menuitem" disabled={signingOut}
                onClick={() => void signOut()}
                className="public-customer-item flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm disabled:opacity-50">
                <LogOut className="h-4 w-4" /> ออกจากระบบ / Sign out
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
