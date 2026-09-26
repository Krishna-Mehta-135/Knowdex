"use client";
import React, { createContext, useEffect, useState } from "react";

import type { AuthState, Session } from "./types";
import { clearOfflineUserData } from "@/components/pwa/RegisterSW";

export const AuthContext = createContext<AuthState>({ status: "loading" });

export function AuthProvider({
  children,
  initialState,
}: {
  children: React.ReactNode;
  initialState?: AuthState;
}) {
  const [state, setState] = useState<AuthState>(
    initialState ?? { status: "loading" },
  );

  useEffect(() => {
    if (initialState?.status === "authenticated") {
      // Keep authenticated UI responsive after redirects; silently revalidate.
      fetch("/api/auth/me")
        .then((r) => (r.ok ? (r.json() as Promise<Session>) : null))
        .then((session) => {
          if (session) {
            setState({ status: "authenticated", session });
          }
        })
        .catch(() => {});
      return;
    }

    // Fetch session from API — cookie is sent automatically if it's not httpOnly
    // But since it IS httpOnly, we need an endpoint that validates it and returns user data
    fetch("/api/auth/me")
      .then((r) => (r.ok ? (r.json() as Promise<Session>) : null))
      .then((session) => {
        setState(
          session
            ? { status: "authenticated", session }
            : { status: "unauthenticated" },
        );
      })
      .catch(() => setState({ status: "unauthenticated" }));
  }, [initialState]);

  // Signed out: forget cached notes/lists so they can't be read offline by the next user.
  useEffect(() => {
    if (state.status === "unauthenticated") clearOfflineUserData();
  }, [state.status]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
