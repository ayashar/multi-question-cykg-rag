import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/ui/sidebar";
import Navbar from "@/components/ui/navbar";
import { GlobalLoadingBar } from "@/components/ui/global-loading-bar";
import { ScreenErrorBoundary } from "@/components/ui/error-states";

const fontSans = Geist({
  variable: "--font-google-sans",
  subsets: ["latin"],
});

const fontMono = Geist_Mono({
  variable: "--font-google-code",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ChatBot KGCS",
  description: "Knowledge Graph Cybersecurity System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${fontMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen flex bg-background text-foreground font-sans">
        <GlobalLoadingBar />
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 min-h-screen">
          <Navbar />
          <main className="flex-1 p-5 md:p-8 overflow-y-auto">
            <ScreenErrorBoundary>
              {children}
            </ScreenErrorBoundary>
          </main>
        </div>
      </body>
    </html>
  );
}
