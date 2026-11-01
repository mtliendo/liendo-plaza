import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Liendo Plaza",
  description: "Kitchen board and family phone for the Liendos: calendar, chores, stars, and dinner.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
