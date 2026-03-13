import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import {
  AlertCircle,
  Download,
  ExternalLink,
  Eye,
  ImagePlus,
  Link2,
  Lock,
  MessageSquare,
  RefreshCw,
  Send,
  X,
} from "lucide-react";

import { PublicContactActionLink, StatusBadge, type BadgeTone } from "../../../components/shared/AppUi";
import { CountdownSection } from "./CountdownSection";
import { OrganizerCard } from "./OrganizerCard";
import { PlatformBrandPane } from "./PlatformBrandPane";
import { PlatformFooter } from "./PlatformFooter";
import { SpeakersSection } from "./SpeakersSection";
import { SponsorsSection } from "./SponsorsSection";
import type { ImageAttachment, PublicEventChatResponse, PublicEventPageResponse, PublicEventRecoveredRegistrationResponse, PublicEventRegistrationResponse } from "../../../types";

type PublicRegistrationFormState = {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
};

type PublicTicketLookupFormState = {
  phone: string;
  email: string;
  attendee_name: string;
};

type PublicChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  mapUrl: string;
  tickets: PublicEventChatResponse["tickets"];
  attachments: ImageAttachment[];
};

type PublicEventPageProps = {
  page: PublicEventPageResponse | null;
  loading: boolean;
  errorMessage: string;
  eventStatusTone: BadgeTone;
  eventStatusLabel: string;
  availabilityTone: BadgeTone;
  availabilityLabel: string;
  mapEmbedUrl: string;
  messengerHref: string;
  lineHref: string;
  phoneHref: string;
  registrationForm: PublicRegistrationFormState;
  onRegistrationFieldChange: (field: keyof PublicRegistrationFormState, value: string) => void;
  registrationSubmitting: boolean;
  registrationError: string;
  registrationResult: PublicEventRegistrationResponse | null;
  onRegistrationSubmit: (event?: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onResetRegistrationFlow: () => void;
  ticketLookupForm: PublicTicketLookupFormState;
  onTicketLookupFieldChange: (field: keyof PublicTicketLookupFormState, value: string) => void;
  ticketLookupSubmitting: boolean;
  ticketLookupError: string;
  onTicketLookupSubmit: (event?: FormEvent<HTMLFormElement>) => void | Promise<void>;
  privacyOpen: boolean;
  onPrivacyOpenChange: (open: boolean) => void;
  chatOpen: boolean;
  onChatOpenChange: (open: boolean) => void;
  chatInput: string;
  onChatInputChange: (value: string) => void;
  chatPendingImages: Array<{ id: string; previewUrl: string; file: File }>;
  chatFileInputRef: RefObject<HTMLInputElement | null>;
  chatBodyRef: RefObject<HTMLDivElement | null>;
  chatMessages: PublicChatMessage[];
  chatSending: boolean;
  chatError: string;
  onChatImageSelect: (event: ChangeEvent<HTMLInputElement>) => void;
  onChatRemoveImage: (id: string) => void;
  onChatSubmit: (event?: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onChatInputKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
};

function isRecoveredPublicRegistrationResult(
  value: PublicEventRegistrationResponse | null,
): value is PublicEventRecoveredRegistrationResponse {
  return Boolean(
    value
    && (value.status === "success" || value.status === "duplicate" || value.status === "recovered"),
  );
}

function AboutSection({ description }: { description: string }) {
  if (!description) return null;

  return (
    <section className="py-3.5 sm:py-4">
      <div className="flex items-center gap-2">
        <Eye className="h-4 w-4 text-blue-600" />
        <h2 className="text-base font-semibold text-slate-900 sm:text-lg">About This Event</h2>
      </div>
      <p className="mt-2.5 whitespace-pre-line text-sm leading-6 text-slate-600">
        {description}
      </p>
    </section>
  );
}

function LocationTravelSection({
  location,
  mapEmbedUrl,
  publicLocationLabel,
}: {
  location: PublicEventPageResponse["location"];
  mapEmbedUrl: string;
  publicLocationLabel: string;
}) {
  return (
    <section className="py-3.5 sm:py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 sm:text-lg">Location & Travel</h2>
          <p className="mt-1 text-sm text-slate-500">
            {location.title || publicLocationLabel}
          </p>
        </div>
        {location.map_url && (
          <a
            href={location.map_url}
            target="_blank"
            rel="noopener noreferrer"
            className="public-page-control inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
          >
            <Link2 className="h-3.5 w-3.5" />
            Open in Maps
          </a>
        )}
      </div>

      <div className="surface-frame mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {mapEmbedUrl ? (
          <iframe
            title="Event location map"
            src={mapEmbedUrl}
            className="h-56 w-full border-0 sm:h-64"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        ) : (
          <div className="flex h-56 items-center justify-center px-6 text-center text-sm text-slate-500 sm:h-64">
            Map preview will appear here when venue details are available.
          </div>
        )}
      </div>

      <dl className="mt-3 grid gap-x-5 gap-y-2 border-t border-slate-200 pt-3 text-sm sm:grid-cols-[5.5rem_minmax(0,1fr)]">
        <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Venue</dt>
        <dd className="font-semibold text-slate-900">{location.title || publicLocationLabel}</dd>
        <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Address</dt>
        <dd className="text-slate-700">{location.address_line || location.address || "-"}</dd>
      </dl>

      {location.travel_info && (
        <div className="mt-3 border-t border-slate-200 pt-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Travel Info</p>
          <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-slate-600">
            {location.travel_info}
          </p>
        </div>
      )}
    </section>
  );
}

export function PublicEventPage({
  page,
  loading,
  errorMessage,
  eventStatusTone,
  eventStatusLabel,
  availabilityTone,
  availabilityLabel,
  mapEmbedUrl,
  messengerHref,
  lineHref,
  phoneHref,
  registrationForm,
  onRegistrationFieldChange,
  registrationSubmitting,
  registrationError,
  registrationResult,
  onRegistrationSubmit,
  onResetRegistrationFlow,
  ticketLookupForm,
  onTicketLookupFieldChange,
  ticketLookupSubmitting,
  ticketLookupError,
  onTicketLookupSubmit,
  privacyOpen,
  onPrivacyOpenChange,
  chatOpen,
  onChatOpenChange,
  chatInput,
  onChatInputChange,
  chatPendingImages,
  chatFileInputRef,
  chatBodyRef,
  chatMessages,
  chatSending,
  chatError,
  onChatImageSelect,
  onChatRemoveImage,
  onChatSubmit,
  onChatInputKeyDown,
}: PublicEventPageProps) {
  const [headerCondensed, setHeaderCondensed] = useState(false);
  const publicEventName = page?.event.name || "Event";
  const publicLocationLabel = page?.location.compact || "Venue details will be announced soon";
  const publicSummary = page?.event.summary || page?.event.description || "";
  const contactVisible = Boolean(
    page?.contact.enabled
    && (
      messengerHref
      || lineHref
      || page.contact.phone.trim()
      || page.contact.hours.trim()
    ),
  );
  const registrationAvailable = Boolean(
    page
    && page.event.registration_enabled
    && page.event.registration_availability === "open",
  );
  const ticketRecoveryMode = page?.event.ticket_recovery_mode || "shared_contact";
  const recoveredRegistrationResult = isRecoveredPublicRegistrationResult(registrationResult)
    ? registrationResult
    : null;
  const ticketReady = Boolean(recoveredRegistrationResult);
  const nameVerificationRequired = registrationResult?.status === "name_verification_required";
  const verifiedRecoveryRequired = registrationResult?.status === "verification_required";
  const availabilityHelper = (() => {
    switch (page?.event.registration_availability) {
      case "full":
        return "This event is full right now.";
      case "closed":
        return "Registration for this event has closed.";
      case "not_started":
        return "Registration has not opened yet.";
      case "invalid":
        return "Registration timing is being updated.";
      default:
        return "Register on this page and save your ticket image immediately.";
    }
  })();
  const mainColumnSections = page
    ? page.sections
        .filter((section) => section.enabled)
        .sort((left, right) => left.order - right.order)
        .map((section) => {
          switch (section.id) {
            case "about":
              return <AboutSection key="about" description={page.event.description} />;
            case "countdown":
              return <CountdownSection key="countdown" countdown={page.countdown} />;
            case "organizer":
              return <OrganizerCard key="organizer" organizer={page.organizer} />;
            case "speakers":
              return <SpeakersSection key="speakers" speakers={page.speakers} />;
            case "sponsors":
              return <SponsorsSection key="sponsors" sponsors={page.sponsors} />;
            case "location":
              return (
                <LocationTravelSection
                  key="location"
                  location={page.location}
                  mapEmbedUrl={mapEmbedUrl}
                  publicLocationLabel={publicLocationLabel}
                />
              );
            default:
              return null;
          }
        })
        .filter(Boolean)
    : [];

  useEffect(() => {
    let frameId = 0;

    const updateHeaderState = () => {
      frameId = 0;
      const nextCondensed = window.scrollY > 40;
      setHeaderCondensed((current) => (current === nextCondensed ? current : nextCondensed));
    };

    const handleScroll = () => {
      if (frameId !== 0) return;
      frameId = window.requestAnimationFrame(updateHeaderState);
    };

    updateHeaderState();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (frameId !== 0) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  return (
    <div className="public-page-selectable min-h-dvh bg-slate-50 text-slate-900 font-sans">
      <header className="sticky top-0 z-40 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
        <AnimatePresence initial={false}>
          {page && !headerCondensed && (
            <motion.div
              key="platform-brand-pane"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="overflow-hidden"
            >
              <PlatformBrandPane brand={page.brand} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/90">
          <div className={`mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 ${headerCondensed ? "py-2" : "py-3"} transition-[padding] duration-200`}>
            <div className="min-w-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{publicEventName}</p>
                {!headerCondensed && (
                  <p className="truncate text-xs text-slate-500">{publicLocationLabel}</p>
                )}
              </div>
            </div>
            {page && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <StatusBadge tone={eventStatusTone}>
                  {eventStatusLabel}
                </StatusBadge>
                <StatusBadge tone={availabilityTone}>
                  {availabilityLabel}
                </StatusBadge>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:py-5">
        {loading ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : errorMessage || !page ? (
          <div className="surface-panel mx-auto max-w-xl rounded-3xl p-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
              <AlertCircle className="h-7 w-7" />
            </div>
            <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">Public page unavailable</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {errorMessage || "This event page is not published or could not be found."}
            </p>
          </div>
        ) : (
          <>
            <section className="grid gap-4 lg:items-start lg:grid-cols-[minmax(0,18.5rem)_minmax(0,1fr)]">
              <div className="surface-panel self-start overflow-hidden rounded-[1.75rem]">
                <div className="aspect-[800/1132] w-full">
                  {page.event.poster_url ? (
                    <img
                      src={page.event.poster_url}
                      alt={`${page.event.name} poster`}
                      className="h-full w-full object-cover object-top"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
                      <Eye className="h-9 w-9 text-slate-400" />
                      <div>
                        <p className="text-sm font-semibold text-slate-700">Event poster</p>
                        <p className="mt-1 text-xs text-slate-500">Recommended size 800 x 1132 px</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="surface-panel space-y-4 rounded-[1.75rem] p-4 lg:self-start sm:p-5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge tone={eventStatusTone}>
                    {eventStatusLabel}
                  </StatusBadge>
                  <StatusBadge tone={availabilityTone}>
                    {availabilityLabel}
                  </StatusBadge>
                </div>

                <div>
                  <h1 className="text-[1.9rem] font-bold tracking-tight text-slate-900 sm:text-[2.35rem]">
                    {page.event.name}
                  </h1>
                  {publicSummary && (
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                      {publicSummary}
                    </p>
                  )}
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2">
                  <div className="surface-tile rounded-xl px-3.5 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Date & Time</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{page.event.date_label}</p>
                    <p className="mt-1 text-xs text-slate-500">{page.event.timezone}</p>
                  </div>
                  <div className="surface-tile rounded-xl px-3.5 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Location</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {page.location.title || publicLocationLabel}
                    </p>
                    {page.location.address_line && (
                      <p className="mt-1 text-xs text-slate-500">{page.location.address_line}</p>
                    )}
                  </div>
                </div>

                <div className={`grid gap-2.5 ${page.event.show_seat_availability ? "sm:grid-cols-3" : "sm:grid-cols-1"}`}>
                  <div className="surface-tile rounded-xl px-3.5 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Registration</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{availabilityHelper}</p>
                  </div>
                  {page.event.show_seat_availability && (
                    <div className="surface-tile rounded-xl px-3.5 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Seats</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {page.event.registration_limit == null
                          ? "Unlimited"
                          : `${page.event.active_registration_count}/${page.event.registration_limit}`}
                      </p>
                    </div>
                  )}
                  {page.event.show_seat_availability && (
                    <div className="surface-tile rounded-xl px-3.5 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Remaining</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {page.event.remaining_seats == null ? "Open" : page.event.remaining_seats}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href="#public-registration"
                    className="public-page-control inline-flex items-center justify-center rounded-full bg-blue-600 px-4.5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
                  >
                    {page.event.cta_label}
                  </a>
                  {page.location.map_url && (
                    <a
                      href={page.location.map_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="public-page-control inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Open in Maps
                    </a>
                  )}
                </div>
              </div>
            </section>

            <section className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,21.5rem)]">
              <div className="divide-y divide-slate-200">
                {mainColumnSections}
              </div>

              <aside id="public-registration" className="space-y-4 xl:sticky xl:top-5 xl:self-start">
                <div className="surface-panel rounded-[1.75rem] p-4 sm:p-5">
                  {!ticketReady ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-semibold text-slate-900">Register</h2>
                          <p className="mt-1 text-sm text-slate-500">
                            Fill in one short form. Your ticket appears on this page immediately.
                          </p>
                        </div>
                        <StatusBadge tone={availabilityTone}>
                          {availabilityLabel}
                        </StatusBadge>
                      </div>

                      {registrationAvailable ? (
                        <form className="mt-4 space-y-2.5" onSubmit={(event) => void onRegistrationSubmit(event)}>
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">First Name</label>
                            <input
                              value={registrationForm.first_name}
                              onChange={(event) => onRegistrationFieldChange("first_name", event.target.value)}
                              autoComplete="given-name"
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="First name"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Last Name</label>
                            <input
                              value={registrationForm.last_name}
                              onChange={(event) => onRegistrationFieldChange("last_name", event.target.value)}
                              autoComplete="family-name"
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Last name"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Phone</label>
                            <input
                              value={registrationForm.phone}
                              onChange={(event) => onRegistrationFieldChange("phone", event.target.value)}
                              autoComplete="tel"
                              inputMode="tel"
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Phone number"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Email</label>
                            <input
                              value={registrationForm.email}
                              onChange={(event) => onRegistrationFieldChange("email", event.target.value)}
                              autoComplete="email"
                              inputMode="email"
                              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Email address"
                            />
                          </div>

                          {registrationError && (
                            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                              {registrationError}
                            </div>
                          )}

                          <button
                            type="submit"
                            disabled={registrationSubmitting}
                            className="public-page-control inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {registrationSubmitting && <RefreshCw className="h-4 w-4 animate-spin" />}
                            {page.event.cta_label}
                          </button>

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-500">
                            <span>Save your ticket image to your phone after submitting.</span>
                            {page.privacy.enabled && (
                              <button
                                type="button"
                                onClick={() => onPrivacyOpenChange(true)}
                                className="public-page-control inline-flex items-center gap-1 font-semibold text-slate-700 transition-colors hover:text-blue-600"
                              >
                                <Lock className="h-3.5 w-3.5" />
                                {page.privacy.label}
                              </button>
                            )}
                          </div>
                        </form>
                      ) : (
                        <div className="surface-subpanel mt-4 rounded-xl px-3.5 py-3.5">
                          <p className="text-sm font-semibold text-slate-900">{availabilityHelper}</p>
                          <p className="mt-2 text-sm leading-6 text-slate-500">
                            This page stays here for event details, location, and ticket recovery when available.
                          </p>
                          {page.privacy.enabled && (
                            <button
                              type="button"
                              onClick={() => onPrivacyOpenChange(true)}
                              className="public-page-control mt-3 inline-flex items-center gap-1 text-xs font-semibold text-slate-700 transition-colors hover:text-blue-600"
                            >
                              <Lock className="h-3.5 w-3.5" />
                              {page.privacy.label}
                            </button>
                          )}
                        </div>
                      )}

                      <div className="surface-subpanel mt-3 rounded-xl px-3.5 py-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">Find My Ticket</p>
                            <p className="mt-1 text-sm leading-6 text-slate-500">
                              {ticketRecoveryMode === "verified_contact"
                                ? "This event is set up for verified ticket recovery. OTP or reference-based release will plug in here for paid events."
                                : "Already registered? Enter your phone number or email. If that contact has multiple attendees, we will ask for the attendee name next."}
                            </p>
                          </div>
                          <StatusBadge tone="neutral">Recovery</StatusBadge>
                        </div>

                        <form className="mt-3 space-y-2.5" onSubmit={(event) => void onTicketLookupSubmit(event)}>
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Phone</label>
                            <input
                              value={ticketLookupForm.phone}
                              onChange={(event) => onTicketLookupFieldChange("phone", event.target.value)}
                              autoComplete="tel"
                              inputMode="tel"
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Phone number"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Email</label>
                            <input
                              value={ticketLookupForm.email}
                              onChange={(event) => onTicketLookupFieldChange("email", event.target.value)}
                              autoComplete="email"
                              inputMode="email"
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="Email address"
                            />
                          </div>
                          {(nameVerificationRequired || verifiedRecoveryRequired) && (
                            <div>
                              <label className="mb-1 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Attendee Name</label>
                              <input
                                value={ticketLookupForm.attendee_name}
                                onChange={(event) => onTicketLookupFieldChange("attendee_name", event.target.value)}
                                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="First and last name"
                              />
                            </div>
                          )}

                          {ticketLookupError && (
                            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                              {ticketLookupError}
                            </div>
                          )}

                          <button
                            type="submit"
                            disabled={ticketLookupSubmitting}
                            className="public-page-control inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {ticketLookupSubmitting && <RefreshCw className="h-4 w-4 animate-spin" />}
                            Find My Ticket
                          </button>
                        </form>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                        <p className="text-sm font-semibold text-emerald-900">
                          {recoveredRegistrationResult?.success_message}
                        </p>
                      </div>

                      <div className="surface-frame overflow-hidden rounded-[1.5rem]">
                        <a href={recoveredRegistrationResult?.ticket.png_url} target="_blank" rel="noopener noreferrer">
                          <img
                            src={recoveredRegistrationResult?.ticket.png_url}
                            alt={`Ticket for ${recoveredRegistrationResult?.registration.id}`}
                            className="w-full"
                          />
                        </a>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <a
                          href={recoveredRegistrationResult?.ticket.png_url}
                          download={`${recoveredRegistrationResult?.registration.id}.png`}
                          className="public-page-control inline-flex items-center justify-center rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
                        >
                          Save Ticket Image
                        </a>
                        {recoveredRegistrationResult?.map_url ? (
                          <a
                            href={recoveredRegistrationResult?.map_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="public-page-control inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
                          >
                            <ExternalLink className="h-4 w-4" />
                            View Map
                          </a>
                        ) : (
                          <a
                            href={recoveredRegistrationResult?.ticket.svg_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="public-page-control inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
                          >
                            <ExternalLink className="h-4 w-4" />
                            Open SVG Copy
                          </a>
                        )}
                      </div>

                      <div className="surface-subpanel rounded-2xl px-4 py-4 text-sm leading-6 text-slate-600">
                        <p className="font-semibold text-slate-900">{recoveredRegistrationResult?.event.name}</p>
                        <p className="mt-1">{recoveredRegistrationResult?.event.date_label}</p>
                        <p className="mt-1">{recoveredRegistrationResult?.event.location}</p>
                        <p className="mt-3 text-xs text-slate-500">
                          Save this image now. Email backup, if configured for this event, will arrive separately.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={onResetRegistrationFlow}
                        className="public-page-control inline-flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-600"
                      >
                        {recoveredRegistrationResult?.status === "success" ? "Register Another Attendee" : "Back to Registration"}
                      </button>
                    </div>
                  )}
                </div>

                {contactVisible && (
                  <div className="surface-panel rounded-[1.75rem] p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold text-slate-900">Help & Contact</h2>
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                          {page.contact.intro}
                        </p>
                      </div>
                      <StatusBadge tone="neutral">Fallback</StatusBadge>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {messengerHref && (
                        <PublicContactActionLink href={messengerHref} label="Chat on Messenger" kind="messenger" />
                      )}
                      {lineHref && (
                        <PublicContactActionLink href={lineHref} label="Chat on LINE" kind="line" />
                      )}
                      {phoneHref && (
                        <PublicContactActionLink href={phoneHref} label={`Call ${page.contact.phone}`} kind="phone" />
                      )}
                    </div>

                    {page.contact.hours && (
                      <div className="surface-tile mt-3 rounded-xl px-3.5 py-3.5">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Support Hours</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{page.contact.hours}</p>
                      </div>
                    )}
                  </div>
                )}
              </aside>
            </section>

            {privacyOpen && page.privacy.enabled && (
              <div
                className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 px-4"
                onClick={() => onPrivacyOpenChange(false)}
              >
                <div
                  className="surface-panel w-full max-w-lg rounded-[2rem] p-6 shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
                        <Lock className="h-5 w-5" />
                      </div>
                      <h2 className="mt-4 text-xl font-bold text-slate-900">{page.privacy.label}</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => onPrivacyOpenChange(false)}
                      className="public-page-control inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                      aria-label="Close privacy notice"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-600">
                    {page.privacy.text}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {!loading && !errorMessage && page && <PlatformFooter brand={page.brand} />}

      {page?.support.bot_enabled && (
        <>
          <AnimatePresence>
            {chatOpen && (
              <motion.div
                initial={{ opacity: 0, y: 18, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 sm:left-auto sm:right-6 sm:w-[25rem]"
              >
                <div className="surface-panel overflow-hidden rounded-[2rem] shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">Event Help</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Ask about schedule, venue, travel, registration, or ticket recovery.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onChatOpenChange(false)}
                      className="public-page-control inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                      aria-label="Close help chat"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div
                    ref={chatBodyRef}
                    className="max-h-[min(56vh,34rem)] space-y-3 overflow-y-auto bg-slate-50/80 px-4 py-4"
                  >
                    {chatMessages.map((message) => {
                      const isAssistant = message.role === "assistant";
                      return (
                        <div key={message.id} className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}>
                          <div
                            className={`max-w-[88%] rounded-[1.5rem] px-4 py-3 text-sm shadow-sm ${
                              isAssistant
                                ? "border border-slate-200 bg-white text-slate-800"
                                : "bg-blue-600 text-white"
                            }`}
                            style={{ fontFamily: "var(--font-edit)" }}
                          >
                            {message.text && <p className="whitespace-pre-line leading-6">{message.text}</p>}

                            {message.attachments.length > 0 && (
                              <div className={`${message.text ? "mt-3" : ""} grid grid-cols-2 gap-2`}>
                                {message.attachments.map((attachment) => (
                                  <a
                                    key={`${message.id}:${attachment.url}`}
                                    href={attachment.absolute_url || attachment.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={`block overflow-hidden rounded-2xl border ${
                                      isAssistant
                                        ? "border-slate-200 bg-slate-50"
                                        : "border-blue-200/60 bg-blue-500/25"
                                    }`}
                                  >
                                    <img
                                      src={attachment.absolute_url || attachment.url}
                                      alt={attachment.name || "Attached image"}
                                      className="h-28 w-full object-cover"
                                      loading="lazy"
                                    />
                                  </a>
                                ))}
                              </div>
                            )}

                            {message.tickets.length > 0 && (
                              <div className={`${message.text ? "mt-3" : ""} space-y-2`}>
                                {message.tickets.map((ticket) => (
                                  <div
                                    key={`${message.id}:${ticket.registration_id}`}
                                    className={`rounded-2xl border px-3 py-3 ${
                                      isAssistant
                                        ? "border-slate-200 bg-slate-50"
                                        : "border-blue-400/60 bg-blue-500/30"
                                    }`}
                                  >
                                    <p className={`text-[11px] font-bold uppercase tracking-[0.16em] ${isAssistant ? "text-slate-500" : "text-blue-100/90"}`}>
                                      Ticket {ticket.registration_id}
                                    </p>
                                    {ticket.summary_text && (
                                      <p className={`mt-2 whitespace-pre-line text-xs leading-5 ${isAssistant ? "text-slate-600" : "text-blue-50"}`}>
                                        {ticket.summary_text}
                                      </p>
                                    )}
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {ticket.png_url && (
                                        <a
                                          href={ticket.png_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className={`public-page-control inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ${
                                            isAssistant
                                              ? "bg-blue-600 text-white"
                                              : "bg-white text-blue-700"
                                          }`}
                                        >
                                          <Download className="h-3.5 w-3.5" />
                                          PNG
                                        </a>
                                      )}
                                      {ticket.svg_url && (
                                        <a
                                          href={ticket.svg_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className={`public-page-control inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                                            isAssistant
                                              ? "border-slate-200 bg-white text-slate-700"
                                              : "border-blue-200/70 bg-transparent text-white"
                                          }`}
                                        >
                                          <ExternalLink className="h-3.5 w-3.5" />
                                          SVG
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {message.mapUrl && (
                              <div className={`${message.text || message.tickets.length > 0 ? "mt-3" : ""}`}>
                                <a
                                  href={message.mapUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`public-page-control inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ${
                                    isAssistant
                                      ? "border border-slate-200 bg-slate-50 text-slate-700"
                                      : "bg-white text-blue-700"
                                  }`}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  Open Map
                                </a>
                              </div>
                            )}

                            <p className={`mt-2 text-[10px] ${isAssistant ? "text-slate-400" : "text-blue-100/80"}`}>
                              {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <form className="border-t border-slate-200 bg-white p-4" onSubmit={(event) => void onChatSubmit(event)}>
                    {chatError && (
                      <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                        {chatError}
                      </div>
                    )}
                    <input
                      ref={chatFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      className="hidden"
                      onChange={onChatImageSelect}
                    />
                    {chatPendingImages.length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-2">
                        {chatPendingImages.map((attachment) => (
                          <div key={attachment.id} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                            <img
                              src={attachment.previewUrl}
                              alt={attachment.file.name}
                              className="h-16 w-16 object-cover"
                            />
                            <button
                              type="button"
                              onClick={() => onChatRemoveImage(attachment.id)}
                              className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/70 text-white"
                              aria-label={`Remove ${attachment.file.name}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <label className="sr-only" htmlFor="public-chat-input">Message</label>
                    <div className="flex items-end gap-2">
                      <button
                        type="button"
                        onClick={() => chatFileInputRef.current?.click()}
                        className="public-page-control inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100"
                        aria-label="Attach image"
                      >
                        <ImagePlus className="h-4 w-4" />
                      </button>
                      <textarea
                        id="public-chat-input"
                        value={chatInput}
                        onChange={(event) => onChatInputChange(event.target.value)}
                        onKeyDown={onChatInputKeyDown}
                        rows={2}
                        placeholder="Ask a question"
                        className="min-h-[4.25rem] flex-1 resize-none rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        style={{ fontFamily: "var(--font-edit)" }}
                      />
                      <button
                        type="submit"
                        disabled={chatSending || (!chatInput.trim() && chatPendingImages.length === 0)}
                        className="public-page-control inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label="Send message"
                      >
                        {chatSending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </button>
                    </div>

                    {contactVisible && (
                      <div className="mt-3 rounded-[1.25rem] border border-slate-200 bg-slate-50 px-3 py-3">
                        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Need a human instead?</p>
                        <p className="mt-1 text-xs leading-5 text-slate-600">
                          {page.contact.intro}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {messengerHref && (
                            <PublicContactActionLink href={messengerHref} label="Messenger" kind="messenger" compact />
                          )}
                          {lineHref && (
                            <PublicContactActionLink href={lineHref} label="LINE" kind="line" compact />
                          )}
                          {phoneHref && (
                            <PublicContactActionLink href={phoneHref} label="Call" kind="phone" compact />
                          )}
                        </div>
                        {page.contact.hours && (
                          <p className="mt-3 text-[11px] text-slate-500">
                            Available: <span className="font-semibold text-slate-700">{page.contact.hours}</span>
                          </p>
                        )}
                      </div>
                    )}
                  </form>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-50 sm:right-6">
            <button
              type="button"
              onClick={() => onChatOpenChange(!chatOpen)}
              className="public-page-control inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_48px_rgba(15,23,42,0.24)] transition-transform hover:-translate-y-0.5"
            >
              {chatOpen ? <X className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
              {chatOpen ? "Close Help" : "Need Help?"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
