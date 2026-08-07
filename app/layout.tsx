import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Manifest Review — DS Smith",
  description: "Triage DS Smith order manifests: Add, Update, Cancel, or Ignore each job.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full antialiased flex flex-col">{children}</body>
    </html>
  );
}
