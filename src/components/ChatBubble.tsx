import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ImageAttachment } from "../types";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ChatBubbleProps {
  text: string;
  type: "incoming" | "outgoing";
  timestamp?: string;
  attachments?: ImageAttachment[];
}

export function ChatBubble({ text, type, timestamp, attachments = [] }: ChatBubbleProps) {
  const isIncoming = type === "incoming";
  const hasText = Boolean(String(text || "").trim());
  const hasAttachments = attachments.length > 0;

  return (
    <div className={cn("flex w-full mb-4", isIncoming ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "chat-selectable max-w-[70%] rounded-2xl px-4 py-2 text-sm leading-relaxed shadow-sm",
          isIncoming
            ? "agent-chat-bubble agent-chat-bubble-incoming bg-white text-slate-800 rounded-bl-none border border-slate-100"
            : "agent-chat-bubble agent-chat-bubble-outgoing bg-blue-600 text-white rounded-br-none"
        )}
        style={{ fontFamily: "var(--font-edit)" }}
      >
        {hasText && <p className="whitespace-pre-wrap">{text}</p>}
        {hasAttachments && (
          <div className={cn("grid grid-cols-2 gap-2", hasText ? "mt-3" : "")}>
            {attachments.map((attachment) => (
              <a
                key={`${attachment.id || attachment.url}:${attachment.url}`}
                href={attachment.absolute_url || attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "block overflow-hidden rounded-xl border",
                  isIncoming
                    ? "border-slate-200 bg-slate-50"
                    : "border-blue-400/50 bg-blue-500/25",
                )}
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
        {timestamp && (
          <span className={cn("text-[10px] mt-1 block opacity-60", isIncoming ? "text-slate-500" : "text-blue-100")}>
            {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  );
}
