"use client";

import { useParams } from "next/navigation";
import { DatabaseView } from "@/components/databases/DatabaseView";

export default function DatabasePage() {
  const { databaseId } = useParams<{ databaseId: string }>();
  return (
    <div className="flex h-full flex-1 flex-col bg-[hsl(var(--sb-bg))] text-white">
      <DatabaseView key={databaseId} id={databaseId} />
    </div>
  );
}
