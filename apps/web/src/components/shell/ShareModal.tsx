"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  LoadingSpinner,
} from "@repo/ui";
import { Globe, Lock, Link2, Users, Check, X } from "lucide-react";

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

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const publicUrl = docId ? `${origin}/p/${docId}` : "";
  const noteLabel = docTitle?.trim() || "this note";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[30rem] gap-0 overflow-hidden rounded-2xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg-panel))] p-0 ring-0 outline-none focus:outline-none text-white shadow-[0_24px_70px_-20px_rgba(0,0,0,0.9),0_0_40px_-16px_hsla(var(--sb-accent-glow)/0.35)]"
      >
        <header className="flex items-start gap-3 border-b border-[hsl(var(--sb-border))] px-5 py-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--sb-accent))]/15 text-[hsl(var(--sb-accent))]">
            <Users size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-semibold leading-tight">
              Share
            </DialogTitle>
            <DialogDescription className="mt-0.5 truncate text-xs text-[hsl(var(--sb-text-muted))]">
              {docId ? `“${noteLabel}” and its workspace` : "Workspace access"}
            </DialogDescription>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-[hsl(var(--sb-text-faint))] transition-colors hover:bg-[hsl(var(--sb-bg-hover))] hover:text-white"
          >
            <X size={18} />
          </button>
        </header>

        <div className="max-h-[70vh] space-y-3 overflow-y-auto p-4 custom-scrollbar">
          {docId && (
            <ShareSection
              icon={docIsPublic ? <Globe size={16} /> : <Lock size={16} />}
              tint={docIsPublic ? "green" : "accent"}
              title="Publish to web"
              description={
                docIsPublic
                  ? "Anyone with the link can read this note — no login needed."
                  : "Off. Only workspace members can open this note."
              }
              checked={docIsPublic}
              busy={isUpdatingDocPrivacy}
              onToggle={handleToggleDocPrivacy}
            >
              {docIsPublic && (
                <LinkRow
                  url={publicUrl}
                  copied={copiedType === "public"}
                  onCopy={() => copyToClipboard("public")}
                  openHref={`/p/${docId}`}
                />
              )}
            </ShareSection>
          )}

          {docId && (
            <div className="flex items-center gap-3 rounded-xl border border-[hsl(var(--sb-border))] px-3.5 py-3">
              <Link2
                size={16}
                className="shrink-0 text-[hsl(var(--sb-text-faint))]"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Link for teammates</p>
                <p className="truncate text-xs text-[hsl(var(--sb-text-muted))]">
                  Opens the note in the app for workspace members.
                </p>
              </div>
              <CopyButton
                copied={copiedType === "document"}
                onClick={() => copyToClipboard("document")}
              />
            </div>
          )}

          <ShareSection
            icon={isPublic ? <Globe size={16} /> : <Lock size={16} />}
            tint={isPublic ? "green" : "accent"}
            title="Public workspace"
            description={
              isPublic
                ? "Anyone can find this workspace and request to join."
                : "Private. People join only through an invite you approve."
            }
            checked={isPublic}
            busy={isUpdatingPrivacy}
            disabled={!isOwner}
            disabledHint="Only the owner can change this"
            onToggle={handleTogglePrivacy}
          >
            <LinkRow
              label="Invite link"
              url={`${origin}/?ws=${workspaceSlug}`}
              copied={copiedType === "workspace"}
              onCopy={() => copyToClipboard("workspace")}
            />
          </ShareSection>

          {isOwner && (
            <section
              aria-label="Join requests"
              className="rounded-xl border border-[hsl(var(--sb-border))]"
            >
              <h3 className="flex items-center justify-between px-3.5 pt-3 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--sb-text-faint))]">
                Join requests
                {joinRequests.length > 0 && (
                  <span className="rounded-full bg-[hsl(var(--sb-accent))]/20 px-2 py-0.5 text-[10px] normal-case tracking-normal text-[hsl(var(--sb-accent))]">
                    {joinRequests.length}
                  </span>
                )}
              </h3>
              <div className="p-2">
                {isLoadingRequests ? (
                  <div className="flex justify-center py-5">
                    <LoadingSpinner size="sm" className="text-white/30" />
                  </div>
                ) : joinRequests.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-[hsl(var(--sb-text-faint))]">
                    No one is waiting to join.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {joinRequests.map((request) => (
                      <li
                        key={request.id}
                        className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[hsl(var(--sb-bg-hover))]"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-600 to-violet-600 text-xs font-semibold uppercase">
                          {request.requester.username.charAt(0)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {request.requester.username}
                          </p>
                          <p className="truncate text-[11px] text-[hsl(var(--sb-text-muted))]">
                            {request.requester.email}
                          </p>
                        </div>
                        <button
                          onClick={() =>
                            handleJoinRequest(request.id, "accept")
                          }
                          disabled={!!processingRequestId}
                          className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
                        >
                          {processingRequestId === request.id ? (
                            <LoadingSpinner size="sm" />
                          ) : (
                            <Check size={13} />
                          )}{" "}
                          Accept
                        </button>
                        <button
                          onClick={() =>
                            handleJoinRequest(request.id, "reject")
                          }
                          disabled={!!processingRequestId}
                          aria-label={`Decline ${request.requester.username}`}
                          className="rounded-lg p-1.5 text-[hsl(var(--sb-text-faint))] transition-colors hover:bg-red-500/15 hover:text-red-300 disabled:opacity-50"
                        >
                          <X size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const TINTS = {
  green: "bg-emerald-500/15 text-emerald-300",
  accent: "bg-[hsl(var(--sb-accent))]/15 text-[hsl(var(--sb-accent))]",
} as const;

/** Accessible on/off switch in the app's accent colour. */
function Switch({
  checked,
  onChange,
  busy,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  busy?: boolean;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled || busy}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--sb-accent))] disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-[hsl(var(--sb-accent))]" : "bg-white/15"}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`}
      >
        {busy && (
          <LoadingSpinner
            size="sm"
            className="h-3 w-3 text-[hsl(var(--sb-accent))]"
          />
        )}
      </span>
    </button>
  );
}

function ShareSection({
  icon,
  tint,
  title,
  description,
  checked,
  busy,
  disabled,
  disabledHint,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  tint: keyof typeof TINTS;
  title: string;
  description: string;
  checked: boolean;
  busy?: boolean;
  disabled?: boolean;
  disabledHint?: string;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-xl border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg))]/40"
    >
      <div className="flex items-center gap-3 px-3.5 py-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TINTS[tint]}`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs leading-snug text-[hsl(var(--sb-text-muted))]">
            {disabled && disabledHint ? disabledHint : description}
          </p>
        </div>
        <Switch
          checked={checked}
          onChange={onToggle}
          busy={busy}
          disabled={disabled}
          label={title}
        />
      </div>
      {children && (
        <div className="border-t border-[hsl(var(--sb-border))] px-3.5 py-2.5">
          {children}
        </div>
      )}
    </section>
  );
}

function CopyButton({
  copied,
  onClick,
}: {
  copied: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${copied ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300" : "border-[hsl(var(--sb-border-hover))] hover:bg-[hsl(var(--sb-bg-hover))]"}`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Read-only URL field with Copy (and an optional Open link). */
function LinkRow({
  url,
  copied,
  onCopy,
  label,
  openHref,
}: {
  url: string;
  copied: boolean;
  onCopy: () => void;
  label?: string;
  openHref?: string;
}) {
  return (
    <div>
      {label && (
        <p className="mb-1 text-[11px] text-[hsl(var(--sb-text-faint))]">
          {label}
        </p>
      )}
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          aria-label={label ?? "Link"}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 truncate rounded-lg border border-[hsl(var(--sb-border))] bg-[hsl(var(--sb-bg))] px-2.5 py-1.5 text-xs text-[hsl(var(--sb-text-muted))] outline-none focus:border-[hsl(var(--sb-accent))]"
        />
        {openHref && (
          <a
            href={openHref}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg px-2 py-1.5 text-xs text-[hsl(var(--sb-text-muted))] no-underline hover:bg-[hsl(var(--sb-bg-hover))] hover:text-white"
          >
            Open
          </a>
        )}
        <CopyButton copied={copied} onClick={onCopy} />
      </div>
    </div>
  );
}
