import type { ChangeEvent, RefObject, ReactNode } from "react";
import { motion } from "motion/react";
import {
  Bot,
  ImagePlus,
  MessageSquare,
  Send,
  Trash2,
  X,
} from "lucide-react";

import type { ChatPart } from "../../../services/gemini";
import { ChatBubble } from "../../../components/ChatBubble";
import { Ticket } from "../../../components/Ticket";
import {
  ActionButton,
  HelpPopover,
  InlineActionsMenu,
  MenuActionItem,
  StatusLine,
} from "../../../components/shared/AppUi";
import type { ImageAttachment } from "../../../types";

type TestMessage = {
  role: "user" | "model";
  timestamp: string;
  parts: ChatPart[];
};

type RegistrationRecord = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  timestamp: string;
};

type PendingTestImageAttachment = {
  id: string;
  file: File;
  previewUrl: string;
};

type EventOperatorGuard = {
  label: string;
  body: ReactNode;
};

type TestConsoleScreenProps = {
  testMessages: TestMessage[];
  eventOperatorGuard: EventOperatorGuard;
  selectedEventStatusLabel: string | null;
  selectedRegistrationAvailabilityLabel: string | null;
  isTyping: boolean;
  extractImageAttachmentsFromParts: (parts: ChatPart[]) => ImageAttachment[];
  registrations: RegistrationRecord[];
  eventName: string;
  attendeeLocationLabel: string;
  eventDateLabel: string;
  resolvedEventMapUrl: string;
  testImageInputRef: RefObject<HTMLInputElement | null>;
  onTestImageSelection: (event: ChangeEvent<HTMLInputElement>) => void;
  testPendingImages: PendingTestImageAttachment[];
  testAttachmentError: string;
  onRemoveTestPendingImage: (attachmentId: string) => void;
  onClearTestPendingImages: () => void;
  inputText: string;
  onInputTextChange: (value: string) => void;
  onTestSend: () => unknown;
  onClearMessages: () => void;
};

export function TestConsoleScreen({
  testMessages,
  eventOperatorGuard,
  selectedEventStatusLabel,
  selectedRegistrationAvailabilityLabel,
  isTyping,
  extractImageAttachmentsFromParts,
  registrations,
  eventName,
  attendeeLocationLabel,
  eventDateLabel,
  resolvedEventMapUrl,
  testImageInputRef,
  onTestImageSelection,
  testPendingImages,
  testAttachmentError,
  onRemoveTestPendingImage,
  onClearTestPendingImages,
  inputText,
  onInputTextChange,
  onTestSend,
  onClearMessages,
}: TestConsoleScreenProps) {
  return (
    <motion.div
      key="test"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100">
            <Bot className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Bot Simulator</h3>
            <StatusLine
              className="mt-0.5"
              items={[
                "Simulator active",
                `${testMessages.length} msgs`,
                eventOperatorGuard.label,
                selectedEventStatusLabel,
                selectedRegistrationAvailabilityLabel,
              ]}
            />
            <div className="mt-1">
              <HelpPopover label="Open note for Simulation Guard">
                {eventOperatorGuard.body}
              </HelpPopover>
            </div>
          </div>
        </div>
        <InlineActionsMenu label="Actions" tone="neutral">
          <MenuActionItem
            onClick={onClearMessages}
            disabled={testMessages.length === 0}
            tone="neutral"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="font-medium">Clear Chat</span>
          </MenuActionItem>
        </InlineActionsMenu>
      </div>

      <div className="chat-scroll chat-selectable flex-1 min-h-0 space-y-2 overflow-y-auto bg-slate-50 p-3 sm:p-4">
        {testMessages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center space-y-4 text-center opacity-40">
            <MessageSquare className="h-10 w-10" />
            <p className="max-w-xs text-sm">Start a conversation to test your bot's custom context.</p>
          </div>
        )}
        {testMessages.map((message, index) => {
          const text = message.parts.find((part) => part.text)?.text;
          const attachments = extractImageAttachmentsFromParts(message.parts);
          const functionCall = message.parts.find((part) => part.functionCall)?.functionCall;
          const functionResponse = message.parts.find((part) => part.functionResponse)?.functionResponse;

          if (functionCall) return null;
          if (functionResponse) {
            const data = functionResponse.response.content;
            const registration = registrations.find((item) => item.id === data.id);
            if (!registration) return null;

            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
              >
                <Ticket
                  registrationId={registration.id}
                  firstName={registration.first_name}
                  lastName={registration.last_name}
                  phone={registration.phone}
                  email={registration.email}
                  timestamp={registration.timestamp}
                  eventName={eventName}
                  eventLocation={attendeeLocationLabel}
                  eventDateLabel={eventDateLabel}
                  eventMapUrl={resolvedEventMapUrl}
                />
              </motion.div>
            );
          }

          return (
            <ChatBubble
              key={index}
              text={text || ""}
              attachments={attachments}
              type={message.role === "user" ? "outgoing" : "incoming"}
              timestamp={message.timestamp}
            />
          );
        })}
        {isTyping && (
          <div className="mb-4 flex justify-start">
            <div className="flex gap-1 rounded-2xl rounded-bl-none border border-slate-100 bg-white px-4 py-3">
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300" />
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:0.2s]" />
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:0.4s]" />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 p-2.5 sm:p-3 lg:px-5 lg:pb-6 lg:pt-3">
        <input
          ref={testImageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={onTestImageSelection}
        />
        {(testPendingImages.length > 0 || testAttachmentError) && (
          <div className="mb-2 space-y-2">
            {testPendingImages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {testPendingImages.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2 py-2"
                  >
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.file.name}
                      className="h-10 w-10 rounded-xl object-cover"
                    />
                    <div className="min-w-0">
                      <p className="max-w-28 truncate text-xs font-medium text-slate-800">{attachment.file.name}</p>
                      <p className="text-[10px] text-slate-500">
                        {Math.max(1, Math.round(attachment.file.size / 1024))} KB
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveTestPendingImage(attachment.id)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:text-slate-700"
                      aria-label={`Remove ${attachment.file.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {testPendingImages.length > 1 && (
                  <button
                    type="button"
                    onClick={onClearTestPendingImages}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600 transition hover:border-rose-300 hover:text-rose-700"
                  >
                    Clear Images
                  </button>
                )}
              </div>
            )}
            {testAttachmentError && <p className="text-xs text-rose-600">{testAttachmentError}</p>}
          </div>
        )}
        <div className="flex gap-2 lg:pr-16">
          <ActionButton
            onClick={() => testImageInputRef.current?.click()}
            tone="neutral"
            className="px-2.5"
            disabled={isTyping || testPendingImages.length >= 4}
            aria-label="Attach image"
            title="Attach image"
          >
            <ImagePlus className="h-4 w-4" />
          </ActionButton>
          <input
            type="text"
            value={inputText}
            onChange={(event) => onInputTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void onTestSend();
              }
            }}
            placeholder="Type a message..."
            className="flex-1 rounded-xl border-none bg-slate-100 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
          <ActionButton
            onClick={() => void onTestSend()}
            disabled={(!inputText.trim() && testPendingImages.length === 0) || isTyping}
            tone="blue"
            active
            className="px-3"
          >
            <Send className="h-5 w-5" />
          </ActionButton>
        </div>
      </div>
    </motion.div>
  );
}
