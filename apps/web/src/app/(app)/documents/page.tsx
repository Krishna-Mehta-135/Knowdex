import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { HomeView } from "@/components/home/HomeView";

/** Workspace home: recent notes, connections waiting, quick actions. */
export default async function DocumentsPage() {
  const cookieStore = await cookies();
  if (!cookieStore.get("session")?.value) redirect("/login");

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[hsl(var(--sb-bg))] text-white custom-scrollbar">
      <HomeView />
    </div>
  );
}
