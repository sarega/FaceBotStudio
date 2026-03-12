import { RefreshCw, Shield } from "lucide-react";

type AuthScreenProps = {
  errorMessage: string;
  username: string;
  password: string;
  submitting: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
};

export function AuthScreen({
  errorMessage,
  username,
  password,
  submitting,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: AuthScreenProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 backdrop-blur p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">FaceBotStudio Admin</h1>
            <p className="text-sm text-slate-300">Sign in to access registrations, logs, and event settings.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">Username</label>
            <input
              value={username}
              onChange={(event) => onUsernameChange(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && !submitting && void onSubmit()}
              className="w-full rounded-2xl bg-slate-900 border border-white/10 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="owner"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && !submitting && void onSubmit()}
              className="w-full rounded-2xl bg-slate-900 border border-white/10 px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>
          {errorMessage && (
            <p className="text-sm text-rose-300">{errorMessage}</p>
          )}
          <button
            onClick={() => void onSubmit()}
            disabled={!username.trim() || !password || submitting}
            className="w-full flex items-center justify-center gap-2 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-3 font-semibold transition-colors"
          >
            {submitting && <RefreshCw className="w-4 h-4 animate-spin" />}
            Sign In
          </button>
        </div>
      </div>
    </div>
  );
}
