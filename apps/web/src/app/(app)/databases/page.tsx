import { Database } from "lucide-react";
import { DatabaseList } from "@/components/databases/DatabaseList";

export default function DatabasesPage() {
  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-[hsl(var(--sb-bg))] text-white custom-scrollbar">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))]/50 px-6">
        <Database className="h-4 w-4 text-[hsl(var(--sb-accent))]" />
        <h1 className="text-sm font-medium">Databases</h1>
      </div>
      <DatabaseList />
    </div>
  );
}
