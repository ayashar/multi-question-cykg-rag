import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { GlobalLoadingBar } from "@/components/ui/global-loading-bar";
import { AppShell } from "@/components/ui/app-shell";

const fontSans = Geist({
  variable: "--font-google-sans",
  subsets: ["latin"],
});

const fontMono = Geist_Mono({
  variable: "--font-google-code",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "ChatBot CSKG",
    template: "%s | ChatBot CSKG",
  },
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
      <body className="min-h-screen bg-background text-foreground font-sans">
        <GlobalLoadingBar />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
