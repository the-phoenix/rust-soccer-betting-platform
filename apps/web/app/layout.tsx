import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PitchPool",
  description: "Frontend for the CosmWasm soccer betting platform.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
