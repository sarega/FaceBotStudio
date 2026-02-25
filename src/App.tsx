import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  MessageSquare, 
  Settings as SettingsIcon, 
  Code, 
  Activity, 
  Send, 
  Bot, 
  User,
  RefreshCw,
  Save,
  Copy,
  CheckCircle2,
  AlertCircle,
  Users,
  Download,
  QrCode,
  Search
} from "lucide-react";
import { getChatResponse } from "./services/gemini";
import { ChatBubble } from "./components/ChatBubble";
import { Ticket } from "./components/Ticket";
import { Message, Settings } from "./types";

interface Registration {
  id: string;
  sender_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  timestamp: string;
  status: string;
}

interface LlmModelOption {
  id: string;
  name: string;
  context_length?: number;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"design" | "test" | "logs" | "settings" | "registrations">("design");
  const [settings, setSettings] = useState<Settings>({ 
    context: "", 
    llm_model: "google/gemini-3-flash-preview",
    verify_token: "",
    event_name: "",
    event_location: "",
    event_map_url: "",
    event_date: "",
    event_description: "",
    event_travel: "",
    reg_limit: "200",
    reg_start: "",
    reg_end: ""
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [testMessages, setTestMessages] = useState<{ role: "user" | "model", parts: { text?: string, functionCall?: any, functionResponse?: any }[], timestamp: string }[]>([]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [copied, setCopied] = useState(false);
  const [searchId, setSearchId] = useState("");
  const [checkinStatus, setCheckinStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [llmModels, setLlmModels] = useState<LlmModelOption[]>([]);
  const [llmModelsLoading, setLlmModelsLoading] = useState(false);
  const [llmModelsError, setLlmModelsError] = useState("");

  useEffect(() => {
    fetchSettings();
    fetchMessages();
    fetchRegistrations();
    fetchLlmModels();
    const interval = setInterval(() => {
      fetchMessages();
      fetchRegistrations();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      setSettings((prev) => ({
        ...prev,
        ...data,
        llm_model: data.llm_model || prev.llm_model,
      }));
    } catch (err) {
      console.error("Failed to fetch settings", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchLlmModels = async () => {
    setLlmModelsLoading(true);
    setLlmModelsError("");
    try {
      const res = await fetch("/api/llm/models");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch LLM models");
      }
      setLlmModels(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to fetch LLM models", err);
      setLlmModelsError(err instanceof Error ? err.message : "Failed to fetch LLM models");
    } finally {
      setLlmModelsLoading(false);
    }
  };

  const fetchMessages = async () => {
    try {
      const res = await fetch("/api/messages");
      const data = await res.json();
      setMessages(data);
    } catch (err) {
      console.error("Failed to fetch messages", err);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      // Show success toast or something
    } catch (err) {
      console.error("Failed to save settings", err);
    } finally {
      setSaving(false);
    }
  };

  const fetchRegistrations = async () => {
    try {
      const res = await fetch("/api/registrations");
      const data = await res.json();
      setRegistrations(data);
    } catch (err) {
      console.error("Failed to fetch registrations", err);
    }
  };

  const handleCheckin = async () => {
    if (!searchId) return;
    setCheckinStatus("loading");
    try {
      const res = await fetch("/api/registrations/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: searchId }),
      });
      if (res.ok) {
        setCheckinStatus("success");
        fetchRegistrations();
        setTimeout(() => {
          setCheckinStatus("idle");
          setSearchId("");
        }, 3000);
      } else {
        setCheckinStatus("error");
      }
    } catch (err) {
      setCheckinStatus("error");
    }
  };

  const handleTestSend = async () => {
    if (!inputText.trim()) return;

    const userMsg = { role: "user" as const, parts: [{ text: inputText }], timestamp: new Date().toISOString() };
    setTestMessages(prev => [...prev, userMsg]);
    setInputText("");
    setIsTyping(true);

    try {
      const history = testMessages.map(m => ({
        role: m.role,
        parts: m.parts
      }));
      
      const response = await getChatResponse(inputText, settings, history);
      
      const parts = response.candidates[0].content.parts;
      const newModelMsg = { role: "model" as const, parts, timestamp: new Date().toISOString() };
      setTestMessages(prev => [...prev, newModelMsg]);

      // Handle function calls
      if (response.functionCalls) {
        for (const call of response.functionCalls) {
          if (call.name === "registerUser") {
            const regData = call.args as any;
            const res = await fetch("/api/registrations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...regData, sender_id: "TEST_USER" }),
            });
            const result = await res.json();
            
            // Send function result back into the LLM conversation
            const funcResponseMsg = { 
              role: "model" as const, 
              parts: [{ 
                functionResponse: { 
                  name: "registerUser", 
                  response: { content: result } 
                } 
              }], 
              timestamp: new Date().toISOString() 
            };
            
            setTestMessages(prev => [...prev, funcResponseMsg]);
            
            // Get follow-up response
            const followUp = await getChatResponse("Registration successful. ID is " + result.id, settings, [...history, newModelMsg, funcResponseMsg]);
            setTestMessages(prev => [...prev, { role: "model", parts: followUp.candidates[0].content.parts, timestamp: new Date().toISOString() }]);
            fetchRegistrations();
          } else if (call.name === "cancelRegistration") {
            const { registration_id } = call.args as any;
            const res = await fetch("/api/registrations/cancel", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: registration_id }),
            });
            const result = await res.json();

            const funcResponseMsg = { 
              role: "model" as const, 
              parts: [{ 
                functionResponse: { 
                  name: "cancelRegistration", 
                  response: { content: result } 
                } 
              }], 
              timestamp: new Date().toISOString() 
            };
            
            setTestMessages(prev => [...prev, funcResponseMsg]);
            
            const followUp = await getChatResponse("Registration " + registration_id + " has been cancelled.", settings, [...history, newModelMsg, funcResponseMsg]);
            setTestMessages(prev => [...prev, { role: "model", parts: followUp.candidates[0].content.parts, timestamp: new Date().toISOString() }]);
            fetchRegistrations();
          }
        }
      }
    } catch (err) {
      console.error("LLM error", err);
      setTestMessages(prev => [...prev, { role: "model", parts: [{ text: "Error: Failed to get response from OpenRouter." }], timestamp: new Date().toISOString() }]);
    } finally {
      setIsTyping(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  const appUrl = process.env.APP_URL || window.location.origin;
  const webhookUrl = `${appUrl}/api/webhook`;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Bot className="text-white w-5 h-5" />
            </div>
            <h1 className="font-bold text-xl tracking-tight">FB Bot Studio</h1>
          </div>
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
            {[
              { id: "design", icon: Code, label: "Design" },
              { id: "test", icon: MessageSquare, label: "Test" },
              { id: "registrations", icon: Users, label: "Registrations" },
              { id: "logs", icon: Activity, label: "Logs" },
              { id: "settings", icon: SettingsIcon, label: "Setup" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.id 
                    ? "bg-white text-blue-600 shadow-sm" 
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {activeTab === "design" && (
            <motion.div
              key="design"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold">Custom Context</h2>
                    <p className="text-sm text-slate-500">Define how your bot should behave and what it knows.</p>
                  </div>
                  <button
                    onClick={saveSettings}
                    disabled={saving}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                  >
                    {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Changes
                  </button>
                </div>
                <textarea
                  value={settings.context}
                  onChange={(e) => setSettings({ ...settings, context: e.target.value })}
                  className="w-full h-96 p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-mono text-sm resize-none"
                  placeholder="Enter system instructions, business details, FAQs, etc..."
                />
              </div>
            </motion.div>
          )}

          {activeTab === "test" && (
            <motion.div
              key="test"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="h-[calc(100vh-200px)] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
            >
              <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <Bot className="text-blue-600 w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">Bot Simulator</h3>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                      <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Active</span>
                    </div>
                  </div>
                </div>
                <button 
                  onClick={() => setTestMessages([])}
                  className="text-xs text-slate-400 hover:text-slate-600 font-medium"
                >
                  Clear Chat
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-2 bg-slate-50/30">
                {testMessages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                    <MessageSquare className="w-12 h-12" />
                    <p className="text-sm max-w-xs">Start a conversation to test your bot's custom context.</p>
                  </div>
                )}
                {testMessages.map((msg, i) => {
                  const text = msg.parts.find(p => p.text)?.text;
                  const funcCall = msg.parts.find(p => p.functionCall)?.functionCall;
                  const funcResp = msg.parts.find(p => p.functionResponse)?.functionResponse;

                  if (funcCall) return null; // Don't show raw function calls
                  if (funcResp) {
                    const data = funcResp.response.content;
                    const reg = registrations.find(r => r.id === data.id);
                    if (!reg) return null;
                    return (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        key={i}
                      >
                        <Ticket 
                          registrationId={reg.id}
                          firstName={reg.first_name}
                          lastName={reg.last_name}
                          phone={reg.phone}
                          email={reg.email}
                          timestamp={reg.timestamp}
                          eventName={settings.event_name}
                          eventLocation={settings.event_location}
                          eventDate={settings.event_date}
                          eventMapUrl={settings.event_map_url}
                        />
                      </motion.div>
                    );
                  }

                  return (
                    <ChatBubble 
                      key={i} 
                      text={text || ""} 
                      type={msg.role === "user" ? "outgoing" : "incoming"} 
                      timestamp={msg.timestamp}
                    />
                  );
                })}
                {isTyping && (
                  <div className="flex justify-start mb-4">
                    <div className="bg-white px-4 py-3 rounded-2xl rounded-bl-none border border-slate-100 flex gap-1">
                      <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce" />
                      <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:0.2s]" />
                      <div className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-slate-100">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleTestSend()}
                    placeholder="Type a message..."
                    className="flex-1 bg-slate-100 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <button
                    onClick={handleTestSend}
                    disabled={!inputText.trim() || isTyping}
                    className="bg-blue-600 hover:bg-blue-700 text-white p-3 rounded-xl transition-all disabled:opacity-50"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "registrations" && (
            <motion.div
              key="registrations"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h2 className="text-lg font-semibold">Registered Attendees</h2>
                          <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded-md uppercase tracking-wider border border-blue-100">
                            {settings.event_name || "Untitled Event"}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500">Manage and export your event registrations.</p>
                      </div>
                      <a 
                        href="/api/registrations/export" 
                        className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium transition-all"
                      >
                        <Download className="w-4 h-4" />
                        Export CSV
                      </a>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                          <tr>
                            <th className="px-6 py-3">ID</th>
                            <th className="px-6 py-3">Name</th>
                            <th className="px-6 py-3">Contact</th>
                            <th className="px-6 py-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {registrations.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">
                                No registrations yet.
                              </td>
                            </tr>
                          ) : (
                            registrations.map((reg) => (
                              <tr key={reg.id} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-6 py-4 font-mono text-xs font-bold text-blue-600">
                                  {reg.id}
                                </td>
                                <td className="px-6 py-4">
                                  <p className="font-medium">{reg.first_name} {reg.last_name}</p>
                                  <p className="text-[10px] text-slate-400">{new Date(reg.timestamp).toLocaleString()}</p>
                                </td>
                                <td className="px-6 py-4">
                                  <p className="text-xs">{reg.phone}</p>
                                  <p className="text-[10px] text-slate-400">{reg.email}</p>
                                </td>
                                <td className="px-6 py-4">
                                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter ${
                                    reg.status === "checked-in" ? "bg-emerald-100 text-emerald-700" : 
                                    reg.status === "cancelled" ? "bg-slate-200 text-slate-500" :
                                    "bg-blue-100 text-blue-700"
                                  }`}>
                                    {reg.status}
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <QrCode className="w-5 h-5 text-blue-600" />
                      Admin Check-in
                    </h3>
                    <p className="text-sm text-slate-500 mb-4">Enter Registration ID to check in attendees at the door.</p>
                    <div className="space-y-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="text"
                          value={searchId}
                          onChange={(e) => setSearchId(e.target.value.toUpperCase())}
                          placeholder="REG-XXXXXX"
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <button
                        onClick={handleCheckin}
                        disabled={!searchId || checkinStatus === "loading"}
                        className={`w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                          checkinStatus === "success" 
                            ? "bg-emerald-500 text-white" 
                            : checkinStatus === "error"
                            ? "bg-rose-500 text-white"
                            : "bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                        }`}
                      >
                        {checkinStatus === "loading" && <RefreshCw className="w-4 h-4 animate-spin" />}
                        {checkinStatus === "success" && <CheckCircle2 className="w-4 h-4" />}
                        {checkinStatus === "error" && <AlertCircle className="w-4 h-4" />}
                        {checkinStatus === "success" ? "Checked In!" : checkinStatus === "error" ? "Invalid ID" : "Check In Attendee"}
                      </button>
                    </div>
                  </div>

                  <div className="bg-slate-900 rounded-2xl p-6 text-white shadow-xl">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                        <Activity className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="font-bold">Event Stats</h4>
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest">Live Updates</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                        <p className="text-2xl font-bold">{registrations.filter(r => r.status !== 'cancelled').length}</p>
                        <p className="text-[10px] text-slate-400 uppercase font-bold">Active</p>
                      </div>
                      <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                        <p className="text-2xl font-bold text-emerald-400">
                          {registrations.filter(r => r.status === "checked-in").length}
                        </p>
                        <p className="text-[10px] text-slate-400 uppercase font-bold">Checked In</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
          {activeTab === "logs" && (
            <motion.div
              key="logs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Live Webhook Logs</h2>
                    <p className="text-sm text-slate-500">Real messages received from your Facebook Page.</p>
                  </div>
                  <button onClick={fetchMessages} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                    <RefreshCw className="w-4 h-4 text-slate-400" />
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider">
                      <tr>
                        <th className="px-6 py-3">Timestamp</th>
                        <th className="px-6 py-3">Sender ID</th>
                        <th className="px-6 py-3">Message</th>
                        <th className="px-6 py-3">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {messages.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">
                            No messages received yet.
                          </td>
                        </tr>
                      ) : (
                        messages.map((msg) => (
                          <tr key={msg.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap text-slate-500">
                              {new Date(msg.timestamp).toLocaleString()}
                            </td>
                            <td className="px-6 py-4 font-mono text-xs text-blue-600">
                              {msg.sender_id}
                            </td>
                            <td className="px-6 py-4 max-w-md truncate">
                              {msg.text}
                            </td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter ${
                                msg.type === "incoming" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                              }`}>
                                {msg.type}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "settings" && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Bot className="w-5 h-5 text-blue-600" />
                        Event Information
                      </h3>
                      <button
                        onClick={saveSettings}
                        disabled={saving}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                      >
                        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save Event Settings
                      </button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Event Name</label>
                        <input
                          value={settings.event_name}
                          onChange={(e) => setSettings({ ...settings, event_name: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="e.g. AI Innovation Summit 2026"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Location</label>
                        <input
                          value={settings.event_location}
                          onChange={(e) => setSettings({ ...settings, event_location: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="e.g. Tech Plaza, Bangkok"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Google Maps URL</label>
                        <input
                          value={settings.event_map_url}
                          onChange={(e) => setSettings({ ...settings, event_map_url: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="https://maps.app.goo.gl/..."
                        />
                      </div>
                      
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Event Date & Time</label>
                        <input
                          type="datetime-local"
                          value={settings.event_date}
                          onChange={(e) => setSettings({ ...settings, event_date: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Description</label>
                        <textarea
                          value={settings.event_description}
                          onChange={(e) => setSettings({ ...settings, event_description: e.target.value })}
                          className="w-full h-24 p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none"
                          placeholder="What is this event about?"
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Travel Instructions</label>
                        <textarea
                          value={settings.event_travel}
                          onChange={(e) => setSettings({ ...settings, event_travel: e.target.value })}
                          className="w-full h-20 p-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none"
                          placeholder="How to get there?"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
                      <Activity className="w-5 h-5 text-blue-600" />
                      Registration Rules
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Max Capacity</label>
                        <input
                          type="number"
                          value={settings.reg_limit}
                          onChange={(e) => setSettings({ ...settings, reg_limit: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Open Date</label>
                        <input
                          type="datetime-local"
                          value={settings.reg_start}
                          onChange={(e) => setSettings({ ...settings, reg_start: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Close Date</label>
                        <input
                          type="datetime-local"
                          value={settings.reg_end}
                          onChange={(e) => setSettings({ ...settings, reg_end: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Bot className="w-5 h-5 text-blue-600" />
                        OpenRouter LLM
                      </h3>
                      <button
                        onClick={fetchLlmModels}
                        disabled={llmModelsLoading}
                        className="p-2 hover:bg-slate-100 rounded-xl transition-colors disabled:opacity-50"
                        title="Refresh model list"
                      >
                        <RefreshCw className={`w-4 h-4 text-slate-500 ${llmModelsLoading ? "animate-spin" : ""}`} />
                      </button>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Model</label>
                        <select
                          value={settings.llm_model}
                          onChange={(e) => setSettings({ ...settings, llm_model: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="google/gemini-3-flash-preview">google/gemini-3-flash-preview (recommended)</option>
                          <option value="openrouter/auto">openrouter/auto</option>
                          {llmModels.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.id}
                              {model.context_length ? ` (${model.context_length.toLocaleString()} ctx)` : ""}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Custom Model ID (optional)</label>
                        <input
                          value={settings.llm_model}
                          onChange={(e) => setSettings({ ...settings, llm_model: e.target.value })}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="e.g. openai/gpt-4o-mini or anthropic/claude-3.5-sonnet"
                        />
                      </div>

                      <p className="text-xs text-slate-500">
                        API key stays on the server in <code>.env</code> as <code>OPENROUTER_API_KEY</code>.
                      </p>
                      {llmModelsError && (
                        <p className="text-xs text-rose-600">{llmModelsError}</p>
                      )}
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <SettingsIcon className="w-5 h-5 text-blue-600" />
                      Webhook Configuration
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Callback URL</label>
                        <div className="flex gap-2">
                          <input
                            readOnly
                            value={webhookUrl}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none"
                          />
                          <button 
                            onClick={() => copyToClipboard(webhookUrl)}
                            className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                          >
                            {copied ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <Copy className="w-5 h-5 text-slate-400" />}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Verify Token</label>
                        <div className="flex gap-2">
                          <input
                            value={settings.verify_token}
                            onChange={(e) => setSettings({ ...settings, verify_token: e.target.value })}
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-mono outline-none"
                          />
                          <button 
                            onClick={saveSettings}
                            className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
                          >
                            <Save className="w-5 h-5 text-blue-600" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
                    <h3 className="text-blue-800 font-semibold mb-2 flex items-center gap-2">
                      <AlertCircle className="w-5 h-5" />
                      System Context
                    </h3>
                    <p className="text-sm text-blue-700 leading-relaxed mb-4">
                      The bot automatically uses the event details above to inform users. You can add additional custom instructions below.
                    </p>
                    <textarea
                      value={settings.context}
                      onChange={(e) => setSettings({ ...settings, context: e.target.value })}
                      className="w-full h-32 p-3 bg-white/50 border border-blue-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-xs resize-none"
                      placeholder="Additional bot instructions..."
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
