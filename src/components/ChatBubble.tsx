import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ChatBubbleProps {
  text: string;
  type: "incoming" | "outgoing";
  timestamp?: string;
}

export function ChatBubble({ text, type, timestamp }: ChatBubbleProps) {
  const isIncoming = type === "incoming";

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
        <p className="whitespace-pre-wrap">{text}</p>
        {timestamp && (
          <span className={cn("text-[10px] mt-1 block opacity-60", isIncoming ? "text-slate-500" : "text-blue-100")}>
            {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  );
}
