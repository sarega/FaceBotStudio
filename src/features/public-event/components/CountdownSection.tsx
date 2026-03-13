import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";

import type { PublicEventPageResponse } from "../../../types";

type CountdownSectionProps = {
  countdown: PublicEventPageResponse["countdown"];
};

type CountdownParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

function getRemainingParts(targetIso: string): CountdownParts {
  const diffMs = Math.max(0, new Date(targetIso).getTime() - Date.now());
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds };
}

function CountdownStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface-tile rounded-xl px-3 py-3 text-center">
      <p className="text-[2rem] font-bold tracking-tight text-slate-900 sm:text-[2.35rem]">{value}</p>
      <p className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{label}</p>
    </div>
  );
}

export function CountdownSection({ countdown }: CountdownSectionProps) {
  const [parts, setParts] = useState(() => getRemainingParts(countdown.target_iso));

  useEffect(() => {
    if (countdown.state !== "upcoming" || !countdown.target_iso) return undefined;

    const tick = () => setParts(getRemainingParts(countdown.target_iso));
    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [countdown.state, countdown.target_iso]);

  if (!countdown.target_iso || countdown.state === "unscheduled" || countdown.state === "past") {
    return null;
  }

  return (
    <section className="py-4 sm:py-5">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-blue-600" />
        <h2 className="text-lg font-semibold text-slate-900">
          {countdown.state === "ongoing" ? "Happening Now" : "Countdown to Event"}
        </h2>
      </div>

      <p className="mt-1.5 text-sm text-slate-500">
        {countdown.state === "ongoing"
          ? `The event is currently running. Started ${countdown.date_label}.`
          : `Starts ${countdown.date_label} (${countdown.timezone}).`}
      </p>

      {countdown.state === "upcoming" ? (
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <CountdownStat label="Days" value={parts.days} />
          <CountdownStat label="Hours" value={parts.hours} />
          <CountdownStat label="Minutes" value={parts.minutes} />
          <CountdownStat label="Seconds" value={parts.seconds} />
        </div>
      ) : (
        <div className="surface-subpanel mt-4 rounded-xl px-3.5 py-3.5">
          <p className="text-sm font-semibold text-slate-900">Doors are open</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Registration and venue details remain available on this page while the event is live.
          </p>
        </div>
      )}
    </section>
  );
}
