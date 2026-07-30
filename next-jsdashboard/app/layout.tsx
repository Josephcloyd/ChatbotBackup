import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "../components/providers/ThemeProvider";

export const metadata: Metadata = {
  title: "LifePlan | Powered by Lifewood PH",
  description: "LifePlan production planning and visualization dashboard",
  icons: {
    icon: [
      { url: "/lifeplan-badge.svg", type: "image/svg+xml" },
      { url: "/lifeplan-leaf.png", type: "image/png" },
    ],
    shortcut: "/lifeplan-badge.svg",
    apple: "/lifeplan-leaf.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <link rel="icon" href="/lifeplan-badge.svg" type="image/svg+xml" />
        <link rel="alternate icon" href="/lifeplan-leaf.png" type="image/png" />
        <link rel="apple-touch-icon" href="/lifeplan-leaf.png" />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
