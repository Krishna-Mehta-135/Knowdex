"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { useDocument } from "@/lib/sync/useDocument";
import { useSyncManager } from "@/lib/sync/SyncContext";
import { useOnlineStatus } from "@/lib/sync/useOnlineStatus";

/**
 * Honest sync state for the open note: offline (edits are safe on this device),
 * reconnecting (with a retry button), and a brief "all synced" confirmation.
 */
export function SyncBanner() {
  const { status } = useDocument();
  const manager = useSyncManager();
  const online = useOnlineStatus();
  const [pending, setPending] = useState(0);
  const [showSynced, setShowSynced] = useState(false);
  const hadTrouble = useRef(false);
  // Don't flash a banner for the normal ~second it takes to connect on load.
  const [grace, setGrace] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setGrace(false), 4000);
    return () => clearTimeout(t);
  }, []);

  const connected = status === "connected";

  useEffect(() => {
    if (connected) return;
    let alive = true;
    const read = () =>
      manager.getPendingCount().then((n) => alive && setPending(n));
    void read();
    const id = setInterval(read, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [connected, manager]);

  useEffect(() => {
    if (!connected) {
      if (!online || status === "error") hadTrouble.current = true;
      return;
    }
    setPending(0);
    if (hadTrouble.current) {
      hadTrouble.current = false;
      setShowSynced(true);
      const t = setTimeout(() => setShowSynced(false), 2500);
      return () => clearTimeout(t);
    }
  }, [connected, online, status]);

  if (showSynced) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 border-b border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 text-xs text-emerald-200"
      >
        <Check size={13} /> Back online — all changes synced.
      </div>
    );
  }
  if (connected || (grace && online)) return null;

  const pendingText =
    pending > 0
      ? ` ${pending} change${pending === 1 ? "" : "s"} waiting to sync.`
      : "";

  if (!online) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-100"
      >
        <CloudOff size={13} /> You’re offline. Your edits are saved on this
        device and will sync when you reconnect.{pendingText}
      </div>
    );
  }

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-sky-500/20 bg-sky-500/10 px-4 py-1.5 text-xs text-sky-100"
    >
      <Loader2 size={13} className="animate-spin" />
      {status === "syncing" ? "Syncing…" : "Reconnecting…"}
      {pendingText}
      <button
        onClick={() => manager.retryNow()}
        className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 hover:bg-white/10"
      >
        <RefreshCw size={11} /> Retry now
      </button>
    </div>
  );
}
