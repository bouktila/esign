import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

const geist = Geist({
  display: "swap",
  subsets: ["latin", "latin-ext"],
  variable: "--font-ui",
});

export const metadata: Metadata = {
  title: "Equity-On Sign",
  description:
    "Sign company documents for Equity-On. Share certificates, written resolutions and the papers that follow a change in who owns what.",
  icons: {
    icon: "/icon.svg",
  },
  robots: {
    follow: false,
    index: false,
    nocache: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} antialiased`}>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
