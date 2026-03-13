import { Mic2, UserRound } from "lucide-react";

import type { PublicEventPageResponse } from "../../../types";

function SpeakerPhoto({ name, photoUrl }: { name: string; photoUrl: string }) {
  if (photoUrl) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white">
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
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
      <UserRound className="h-5 w-5" />
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

      <div className="mt-3 divide-y divide-slate-200">
        {visibleSpeakers.map((speaker, index) => (
          <article
            key={`${speaker.name}:${speaker.photoUrl}:${index}`}
            className={`flex gap-3 ${index === 0 ? "pt-0" : "pt-3"}`}
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
