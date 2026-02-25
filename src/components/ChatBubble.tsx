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
          "max-w-[70%] px-4 py-2 rounded-2xl text-sm shadow-sm",
          isIncoming
            ? "bg-white text-slate-800 rounded-bl-none border border-slate-100"
            : "bg-blue-600 text-white rounded-br-none"
        )}
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
