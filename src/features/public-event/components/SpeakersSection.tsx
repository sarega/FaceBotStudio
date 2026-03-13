import { Mic2, UserRound } from "lucide-react";

import type { PublicEventPageResponse } from "../../../types";

function SpeakerPhoto({ name, photoUrl }: { name: string; photoUrl: string }) {
  if (photoUrl) {
    return (
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
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
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
      <UserRound className="h-6 w-6" />
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
    <section className="py-4 sm:py-5">
      <div className="flex items-center gap-2">
        <Mic2 className="h-4 w-4 text-blue-600" />
        <h2 className="text-lg font-semibold text-slate-900">Speakers</h2>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {visibleSpeakers.map((speaker, index) => (
          <article
            key={`${speaker.name}:${speaker.photoUrl}:${index}`}
            className="rounded-[1.25rem] border border-slate-200 bg-white p-3.5 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <SpeakerPhoto name={speaker.name} photoUrl={speaker.photoUrl} />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-slate-900 sm:text-[15px]">{speaker.name}</h3>
                {(speaker.title || speaker.company) && (
                  <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
                    {[speaker.title, speaker.company].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            </div>

            {speaker.bio && (
              <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">
                {speaker.bio}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
