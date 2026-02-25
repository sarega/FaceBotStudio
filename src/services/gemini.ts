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

export async function getChatResponse(
  message: string,
  settings: any,
  history: ChatHistoryMessage[],
): Promise<ChatResponse> {
  const res = await fetch("/api/llm/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, settings, history }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || "Failed to get response from OpenRouter");
  }

  return data;
}
