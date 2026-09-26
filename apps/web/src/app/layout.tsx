import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { API_BASE_URL } from "@/lib/api/config";

import { TooltipProvider, Toaster } from "@repo/ui";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { RegisterSW } from "@/components/pwa/RegisterSW";
import type { AuthState, Session } from "@/lib/auth/types";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Knowdex",
  description: "Your digital knowledge companion",
  icons: {
    icon: "/purple-atom-logo.svg",
    apple: "/purple-atom-logo.svg",
  },
};

async function getInitialAuthState(): Promise<AuthState> {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;

  console.log(`[Layout] Session token found: ${!!token}`);

  if (!token) {
    return { status: "unauthenticated" };
  }

  try {
    console.log(`[Layout] Validating session with backend: ${API_BASE_URL}`);
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn(`[Layout] Session validation failed: ${res.status}`);
      return { status: "unauthenticated" };
    }

    const session = (await res.json()) as Session;
    console.log(
      `[Layout] Session validated successfully for: ${session.user.email}`,
    );
    return { status: "authenticated", session };
  } catch (error) {
    console.error(`[Layout] Error connecting to backend:`, error);
    return { status: "unauthenticated" };
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialAuthState = await getInitialAuthState();

  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      data-scroll-behavior="smooth"
    >
      <body className="sb-root font-sans antialiased bg-background text-foreground">
        <AuthProvider initialState={initialAuthState}>
          <TooltipProvider>
            {children}
            <RegisterSW />
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
