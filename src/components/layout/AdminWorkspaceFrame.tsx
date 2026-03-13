import type { ReactNode } from "react";

type AdminWorkspaceFrameProps = {
  isChatConsoleTab: boolean;
  isAgentMobileFocusMode: boolean;
  canEditSettings: boolean;
  header: ReactNode;
  sidebar: ReactNode;
  dock?: ReactNode;
  children: ReactNode;
};

export function AdminWorkspaceFrame({
  isChatConsoleTab,
  isAgentMobileFocusMode,
  canEditSettings,
  header,
  sidebar,
  dock,
  children,
}: AdminWorkspaceFrameProps) {
  return (
    <div className="app-shell flex h-dvh flex-col overflow-hidden bg-slate-50 font-sans text-slate-900">
      {header}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {sidebar}

        <section
          className={
            isChatConsoleTab
              ? "min-w-0 flex flex-1 min-h-0 flex-col overflow-hidden"
              : "min-w-0 flex flex-1 flex-col"
          }
        >
          <main
            className={
              isChatConsoleTab
                ? "min-w-0 flex-1 min-h-0 overflow-hidden"
                : "min-w-0 flex-1 min-h-0 overflow-y-auto"
            }
          >
            <div
              className={
                isChatConsoleTab
                  ? isAgentMobileFocusMode
                    ? "h-full min-h-0 overflow-hidden"
                    : "mx-auto h-full min-h-0 w-full max-w-[96rem] overflow-hidden px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-4"
                  : `mx-auto w-full max-w-[96rem] px-3 py-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-4 lg:px-6 lg:py-4 ${canEditSettings ? "lg:pb-28" : ""}`
              }
            >
              {children}
            </div>
          </main>
        </section>
      </div>

      {dock}
    </div>
  );
}
