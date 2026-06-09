import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Kinetico M&A",
    template: "%s · Kinetico M&A",
  },
  description: "Kinetico Health — M&A pipeline and deal management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
