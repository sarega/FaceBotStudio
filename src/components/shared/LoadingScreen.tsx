import { RefreshCw } from "lucide-react";

export function LoadingScreen({
  fullHeightClass = "min-h-screen",
}: {
  fullHeightClass?: string;
}) {
  return (
    <div className={`${fullHeightClass} bg-slate-50 flex items-center justify-center`}>
      <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
    </div>
  );
}
