"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  LoadingSpinner,
} from "@repo/ui";
import { Globe, Lock, Link2, Users, Check, XCircle } from "lucide-react";

interface JoinRequest {
  id: string;
  requester: {
    id: string;
    username: string;
    email: string;
  };
  createdAt: string;
}

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  isPublic: boolean; // workspace privacy
  isOwner: boolean;
  docId?: string;
  docTitle?: string;
  docIsPublic?: boolean; // NEW: per-document privacy
  onPrivacyChange?: (isPublic: boolean) => void;
  onDocPrivacyChange?: (isPublic: boolean) => void; // NEW: per-document callback
}

export function ShareModal({
  isOpen,
  onClose,
  workspaceId,
  workspaceSlug,
  isPublic: initialIsPublic,
  isOwner,
  docId,
  docTitle,
  docIsPublic: initialDocIsPublic = false,
  onPrivacyChange,
  onDocPrivacyChange,
}: ShareModalProps) {
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [docIsPublic, setDocIsPublic] = useState(initialDocIsPublic);
  const [isUpdatingPrivacy, setIsUpdatingPrivacy] = useState(false);
  const [isUpdatingDocPrivacy, setIsUpdatingDocPrivacy] = useState(false);
  const [copiedType, setCopiedType] = useState<
    "workspace" | "document" | "public" | null
  >(null);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(
    null,
  );

  const fetchJoinRequests = useCallback(async () => {
    setIsLoadingRequests(true);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/join-requests`);
      if (res.ok) {
        const data = await res.json();
        setJoinRequests(Array.isArray(data.data) ? data.data : []);
      }
    } catch (err) {
      console.error("Failed to fetch join requests", err);
    } finally {
      setIsLoadingRequests(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    setIsPublic(initialIsPublic);
  }, [initialIsPublic]);

  useEffect(() => {
    setDocIsPublic(initialDocIsPublic);
  }, [initialDocIsPublic]);

  useEffect(() => {
    if (isOpen && isOwner) {
      void fetchJoinRequests();
    }
  }, [isOpen, isOwner, fetchJoinRequests]);

  const handleTogglePrivacy = async () => {
    if (!isOwner) return;
    setIsUpdatingPrivacy(true);
    const newStatus = !isPublic;
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: newStatus }),
      });
      if (res.ok) {
        setIsPublic(newStatus);
        onPrivacyChange?.(newStatus);
      }
    } catch (err) {
      console.error("Failed to update privacy", err);
    } finally {
      setIsUpdatingPrivacy(false);
    }
  };

  const handleToggleDocPrivacy = async () => {
    if (!docId) return;
    setIsUpdatingDocPrivacy(true);
    const newStatus = !docIsPublic;
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: newStatus }),
      });
      if (res.ok) {
        setDocIsPublic(newStatus);
        onDocPrivacyChange?.(newStatus);
      }
    } catch (err) {
      console.error("Failed to update document privacy", err);
    } finally {
      setIsUpdatingDocPrivacy(false);
    }
  };

  const copyToClipboard = (type: "workspace" | "document" | "public") => {
    let url = "";
    if (type === "workspace") {
      url = `${window.location.origin}/?ws=${workspaceSlug}`;
    } else if (type === "document" && docId) {
      url = `${window.location.origin}/documents/${docId}`;
    } else if (type === "public" && docId) {
      url = `${window.location.origin}/p/${docId}`;
    }

    if (url) {
      navigator.clipboard.writeText(url).then(() => {
        setCopiedType(type);
        setTimeout(() => setCopiedType(null), 2000);
      });
    }
  };

  const handleJoinRequest = async (
    requestId: string,
    action: "accept" | "reject",
  ) => {
    setProcessingRequestId(requestId);
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/join-requests/${requestId}/${action}`,
        { method: "POST" },
      );
      if (res.ok) {
        setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
      }
    } catch (err) {
      console.error(`Failed to ${action} request`, err);
    } finally {
      setProcessingRequestId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md bg-[#0a0a0a]/95 border-white/10 text-white shadow-[0_0_80px_-15px_rgba(0,0,0,0.9),0_0_30px_-5px_hsla(var(--sb-accent-glow)/0.4)] rounded-[2.5rem] p-0 overflow-hidden backdrop-blur-2xl border-t-white/20 animate-in zoom-in-95 duration-300"
      >
        <div className="p-8 space-y-8 relative">
          <button
            onClick={onClose}
            className="absolute top-8 right-8 p-2 rounded-xl bg-white/5 text-white/40 hover:text-white hover:bg-white/10 transition-all active:scale-90 z-10"
          >
            <XCircle size={20} />
          </button>

          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-4">
              <div className="p-3 rounded-2xl bg-[hsl(var(--sb-accent))]/10 shadow-inner">
                <Users className="text-[hsl(var(--sb-accent))]" size={24} />
              </div>
              Share & Permissions
            </DialogTitle>
            <DialogDescription className="text-white/40 text-sm mt-2 leading-relaxed">
              Manage access for this workspace and the current document. Private
              docs stay hidden even if the workspace is shared.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] ml-1">
              Privacy Controls
            </h3>

            {/* Workspace Privacy Toggle */}
            <div className="bg-white/[0.03] border border-white/10 rounded-[1.5rem] p-5 flex items-center justify-between group hover:bg-white/[0.06] transition-all hover:border-[hsl(var(--sb-accent))]/30">
              <div className="flex items-center gap-4">
                <div
                  className={`p-3.5 rounded-2xl ${isPublic ? "bg-green-500/10 text-green-400" : "bg-blue-500/10 text-blue-400"} shadow-inner group-hover:scale-105 transition-transform`}
                >
                  {isPublic ? <Globe size={22} /> : <Lock size={22} />}
                </div>
                <div>
                  <div className="text-sm font-bold flex items-center gap-2">
                    {isPublic ? "Public Workspace" : "Private Workspace"}
                  </div>
                  <div className="text-[11px] text-white/30 mt-0.5">
                    {isPublic
                      ? "Anyone can view and join via link."
                      : "Access requires owner approval."}
                  </div>
                </div>
              </div>
              {isOwner && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTogglePrivacy}
                  disabled={isUpdatingPrivacy}
                  className="h-9 px-5 rounded-xl text-[11px] font-bold uppercase tracking-wider border-white/20 bg-white/5 hover:bg-white/10 text-white transition-all active:scale-95 shadow-sm"
                >
                  {isUpdatingPrivacy ? <LoadingSpinner size="sm" /> : "Change"}
                </Button>
              )}
            </div>

            {/* Document Privacy Toggle */}
            {docId && (
              <div className="bg-white/[0.03] border border-white/10 rounded-[1.5rem] p-5 flex items-center justify-between group hover:bg-white/[0.06] transition-all hover:border-blue-500/30">
                <div className="flex items-center gap-4">
                  <div
                    className={`p-3.5 rounded-2xl ${docIsPublic ? "bg-green-500/10 text-green-400" : "bg-blue-500/10 text-blue-400"} shadow-inner group-hover:scale-105 transition-transform`}
                  >
                    {docIsPublic ? <Globe size={22} /> : <Lock size={22} />}
                  </div>
                  <div>
                    <div className="text-sm font-bold flex items-center gap-2">
                      {docIsPublic ? "Public Document" : "Private Document"}
                    </div>
                    <div className="text-[11px] text-white/30 mt-0.5 truncate max-w-[160px]">
                      {docIsPublic
                        ? "Anyone with the link can view."
                        : "Only members can view this doc."}
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToggleDocPrivacy}
                  disabled={isUpdatingDocPrivacy}
                  className="h-9 px-5 rounded-xl text-[11px] font-bold uppercase tracking-wider border-white/20 bg-white/5 hover:bg-white/10 text-white transition-all active:scale-95 shadow-sm"
                >
                  {isUpdatingDocPrivacy ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    "Change"
                  )}
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] ml-1">
              Sharing Channels
            </h3>
            <div className="grid grid-cols-2 gap-5">
              <button
                onClick={() => copyToClipboard("workspace")}
                className="flex flex-col items-center justify-center p-6 rounded-[2rem] border border-white/10 bg-white/[0.02] hover:bg-[hsl(var(--sb-accent))]/10 hover:border-[hsl(var(--sb-accent))]/30 transition-all group relative overflow-hidden"
              >
                <div className="w-14 h-14 rounded-2xl bg-[hsl(var(--sb-accent))]/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-lg group-hover:shadow-[hsl(var(--sb-accent))]/20">
                  {copiedType === "workspace" ? (
                    <Check size={28} className="text-green-400" />
                  ) : (
                    <Users size={28} className="text-[hsl(var(--sb-accent))]" />
                  )}
                </div>
                <span className="text-sm font-bold">Workspace</span>
                <span className="text-[10px] text-white/20 mt-1 uppercase tracking-tighter">
                  Copy join link
                </span>
              </button>

              <button
                onClick={() => copyToClipboard("document")}
                disabled={!docId}
                className="flex flex-col items-center justify-center p-6 rounded-[2rem] border border-white/10 bg-white/[0.02] hover:bg-blue-500/10 hover:border-blue-500/30 transition-all group disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-lg group-hover:shadow-blue-500/20">
                  {copiedType === "document" ? (
                    <Check size={28} className="text-green-400" />
                  ) : (
                    <Link2 size={28} className="text-blue-400" />
                  )}
                </div>
                <span className="text-sm font-bold">Document</span>
                <span className="text-[10px] text-white/20 mt-1 uppercase tracking-tighter truncate w-full px-2">
                  {docTitle || "Current page"}
                </span>
              </button>
            </div>
          </div>

          {docId && docIsPublic && (
            <div className="flex items-center gap-3 rounded-2xl border border-green-500/20 bg-green-500/5 px-4 py-3">
              <Globe size={18} className="shrink-0 text-green-400" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white/80">
                  Published page — anyone can read it, no login
                </p>
                <a
                  href={`/p/${docId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-[11px] text-green-300/80 hover:underline"
                >
                  {typeof window !== "undefined" ? window.location.origin : ""}
                  /p/{docId}
                </a>
              </div>
              <button
                onClick={() => copyToClipboard("public")}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs hover:bg-white/10"
              >
                {copiedType === "public" ? "Copied" : "Copy link"}
              </button>
            </div>
          )}

          {/* Join Requests (Owner Only) */}
          {isOwner && (
            <div className="space-y-4 pt-2 border-t border-white/5">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] ml-1">
                  Pending Requests{" "}
                  {joinRequests.length > 0 && `(${joinRequests.length})`}
                </h3>
              </div>

              <div className="max-h-[220px] overflow-y-auto space-y-3 pr-1 custom-scrollbar">
                {isLoadingRequests ? (
                  <div className="flex justify-center py-6">
                    <LoadingSpinner size="md" className="text-white/20" />
                  </div>
                ) : joinRequests.length === 0 ? (
                  <div className="text-center py-10 border-2 border-dashed border-white/5 rounded-[2rem] bg-white/[0.01]">
                    <Users size={32} className="mx-auto text-white/5 mb-3" />
                    <p className="text-[11px] text-white/20 font-medium">
                      No pending join requests
                    </p>
                  </div>
                ) : (
                  joinRequests.map((request) => (
                    <div
                      key={request.id}
                      className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] transition-all group/item"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-bold truncate group-hover/item:text-white transition-colors">
                          {request.requester.username}
                        </div>
                        <div className="text-[10px] text-white/30 truncate mt-0.5">
                          {request.requester.email}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() =>
                            handleJoinRequest(request.id, "accept")
                          }
                          disabled={!!processingRequestId}
                          className="w-10 h-10 rounded-xl bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-all flex items-center justify-center active:scale-90"
                          title="Accept"
                        >
                          {processingRequestId === request.id ? (
                            <LoadingSpinner size="sm" />
                          ) : (
                            <Check size={18} />
                          )}
                        </button>
                        <button
                          onClick={() =>
                            handleJoinRequest(request.id, "reject")
                          }
                          disabled={!!processingRequestId}
                          className="w-10 h-10 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all flex items-center justify-center active:scale-90"
                          title="Reject"
                        >
                          <XCircle size={18} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
