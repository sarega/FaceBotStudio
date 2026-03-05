type ChatPart = {
  text?: string;
  functionCall?: any;
  functionResponse?: any;
};

type ChatHistoryMessage = {
  role: "user" | "model";
  parts: ChatPart[];
};

type ChatResponse = {
  candidates: Array<{
    content: {
      parts: ChatPart[];
    };
  }>;
  functionCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
};

type AdminAgentAction = {
  name: string;
  args: Record<string, unknown>;
  source?: "llm" | "rule";
};

export type AdminAgentResponse = {
  reply: string;
  action: AdminAgentAction | null;
  result?: Record<string, unknown> | null;
  meta?: {
    model?: string;
    provider?: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      estimated_cost_usd: number;
    };
  };
};

export async function getChatResponse(
  message: string,
  settings: any,
  history: ChatHistoryMessage[],
  eventId?: string,
): Promise<ChatResponse> {
  const res = await fetch("/api/llm/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, settings, history, event_id: eventId }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof (data as any).error === "string"
      ? (data as any).error
      : `LLM request failed (${res.status})`;
    throw new Error(message);
  }

  return data as ChatResponse;
}

export async function getAdminAgentResponse(
  message: string,
  settings: any,
  history: ChatHistoryMessage[],
  eventId?: string,
): Promise<AdminAgentResponse> {
  const res = await fetch("/api/admin-agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, settings, history, event_id: eventId }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data?.error === "string" && data.error.trim()
      ? data.error
      : `Admin Agent request failed (${res.status})`;
    throw new Error(message);
  }

  return {
    reply: typeof data?.reply === "string" ? data.reply : "",
    action: data?.action && typeof data.action === "object"
      ? {
          name: String((data.action as Record<string, unknown>).name || ""),
          args: ((data.action as Record<string, unknown>).args as Record<string, unknown>) || {},
          source: (data.action as Record<string, unknown>).source === "rule" ? "rule" : "llm",
        }
      : null,
    result: data?.result && typeof data.result === "object" ? data.result as Record<string, unknown> : null,
    meta: data?.meta && typeof data.meta === "object" ? data.meta as AdminAgentResponse["meta"] : undefined,
  };
}
