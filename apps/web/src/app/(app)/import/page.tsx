import { Suspense } from "react";
import { Upload } from "lucide-react";
import { ImportView } from "@/components/import/ImportView";

export default function ImportPage() {
  return (
    <div className="flex h-full flex-1 flex-col overflow-y-auto bg-[hsl(var(--sb-bg))] text-white custom-scrollbar">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))]/50 px-6">
        <Upload className="h-4 w-4 text-[hsl(var(--sb-accent))]" />
        <h1 className="text-sm font-medium">Import &amp; clip</h1>
      </div>
      <Suspense>
        <ImportView />
      </Suspense>
    </div>
  );
}
