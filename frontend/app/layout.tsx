import type { Metadata } from "next";
import { Google_Sans, Google_Sans_Code } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/ui/sidebar";
import Navbar from "@/components/ui/navbar";
import { GlobalLoadingBar } from "@/components/ui/global-loading-bar";
import { ScreenErrorBoundary } from "@/components/ui/error-states";

const googleSans = Google_Sans({
  variable: "--font-google-sans",
  subsets: ["latin"],
});

const googleSansCode = Google_Sans_Code({
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
      className={`${googleSans.variable} ${googleSansCode.variable} h-full antialiased`}
    >
      <body className="min-h-screen flex bg-background text-foreground font-sans">
        <GlobalLoadingBar />
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 min-h-screen">
          <Navbar />
          <main className="flex-1 p-8 overflow-y-auto">
            <ScreenErrorBoundary>
              {children}
            </ScreenErrorBoundary>
          </main>
        </div>
      </body>
    </html>
  );
}
