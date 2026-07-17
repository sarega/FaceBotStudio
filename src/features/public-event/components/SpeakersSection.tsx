import { Mic2, UserRound } from "lucide-react";

import type { PublicEventPageResponse } from "../../../types";

function SpeakerPhoto({ name, photoUrl }: { name: string; photoUrl: string }) {
  if (photoUrl) {
    return (
      <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm sm:h-28 sm:w-28">
        <img
          src={photoUrl}
          alt={name}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 sm:h-28 sm:w-28">
      <UserRound className="h-8 w-8" />
    </div>
  );
}

type SpeakersSectionProps = {
  speakers: PublicEventPageResponse["speakers"];
};

export function SpeakersSection({ speakers }: SpeakersSectionProps) {
  const visibleSpeakers = speakers.entries.filter((speaker) => speaker.name.trim());
  if (visibleSpeakers.length === 0) return null;

  return (
    <section className="py-3.5 sm:py-4">
      <div className="flex items-center gap-2">
        <Mic2 className="h-4 w-4 text-blue-600" />
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">Speakers</h2>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {visibleSpeakers.map((speaker, index) => (
          <article
            key={`${speaker.name}:${speaker.photoUrl}:${index}`}
            className="surface-tile flex items-start gap-4 rounded-2xl p-3.5"
          >
            <SpeakerPhoto name={speaker.name} photoUrl={speaker.photoUrl} />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-900 sm:text-[15px]">{speaker.name}</h3>
              {(speaker.title || speaker.company) && (
                <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
                  {[speaker.title, speaker.company].filter(Boolean).join(" · ")}
                </p>
              )}
              {speaker.bio && (
                <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-slate-600">
                  {speaker.bio}
                </p>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
