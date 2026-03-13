import { Activity } from "lucide-react";

import { ActionButton, CompactStatRow, StatusLine } from "../shared/AppUi";

type WorkspaceInsightsDockProps = {
  visible: boolean;
  open: boolean;
  onToggle: () => void;
  selectedEventStatusLabel: string;
  hasAnyUnsavedSettings: boolean;
  activeLlmModel: string;
  eventTokens: string;
  totalCost: string;
};

export function WorkspaceInsightsDock({
  visible,
  open,
  onToggle,
  selectedEventStatusLabel,
  hasAnyUnsavedSettings,
  activeLlmModel,
  eventTokens,
  totalCost,
}: WorkspaceInsightsDockProps) {
  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-[calc(1.5rem+16rem)] z-20 hidden lg:block">
      <div className="pointer-events-auto flex items-end gap-2">
        {open && (
          <div className="app-floating-status w-[min(30rem,calc(100vw-10rem))] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_20px_50px_rgba(15,23,42,0.12)] backdrop-blur">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Workspace Insights</p>
            <StatusLine
              className="mt-1"
              items={[
                selectedEventStatusLabel,
                hasAnyUnsavedSettings ? "Unsaved changes" : "Saved",
                <>Model {activeLlmModel}</>,
              ]}
            />
            <CompactStatRow
              className="mt-2"
              stats={[
                { label: "Event tokens", value: eventTokens, tone: "blue" },
                { label: "Total cost", value: totalCost, tone: "neutral" },
              ]}
            />
          </div>
        )}
        <ActionButton
          onClick={onToggle}
          tone={open ? "blue" : "neutral"}
          className="h-11 rounded-2xl px-3 text-sm"
        >
          <Activity className="h-4 w-4" />
          {open ? "Hide Insights" : "Insights"}
        </ActionButton>
      </div>
    </div>
  );
}
