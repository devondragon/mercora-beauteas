/**
 * === Root Layout Component ===
 *
 * The main layout component that wraps all pages in the application.
 * Provides global styling, authentication context, navigation, and
 * notification systems for a consistent user experience.
 *
 * === Features ===
 * - **Global Layout**: Header, main content area, and footer structure
 * - **Authentication Provider**: Clerk authentication with dark theme
 * - **Typography**: Geist font family for modern, clean appearance
 * - **Toast Notifications**: Sonner toaster with custom orange styling
 * - **Dynamic Routing**: Force dynamic rendering for server-side auth
 * - **Responsive Design**: Mobile-first approach with proper viewport handling
 * - **SEO Optimization**: Proper metadata and semantic HTML structure
 *
 * === Technical Implementation ===
 * - **Next.js App Router**: Latest routing system with layout nesting
 * - **Clerk Integration**: Full authentication provider with custom theming
 * - **Font Optimization**: Google Fonts with variable font loading
 * - **CSS Variables**: Custom properties for consistent design system
 * - **Toast System**: Global notification system with custom positioning
 *
 * === Authentication ===
 * - ClerkProvider wraps entire app for auth context
 * - Dark theme configuration for consistent brand experience
 * - Server-side auth support with dynamic rendering
 * - User button and sign-in flows integrated globally
 *
 * === Layout Structure ===
 * - **Header**: Navigation and user controls
 * - **Main**: Page content with minimum height
 * - **Footer**: Site information and links
 * - **Toaster**: Global notification overlay
 *
 * === Usage ===
 * Automatically wraps all pages as root layout in app router
 *
 * @param children - Page content to render within layout
 * @returns JSX element with complete application layout
 */

export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { Lora, Alegreya } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import PromotionalBanner from "@/components/PromotionalBanner";
import { Toaster } from "sonner";
import { Suspense } from "react";
import WebVitals from "@/components/analytics/WebVitals";
import { ClerkProvider } from "@clerk/nextjs";

// Configure primary font family - Lora for headings
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  weight: ["400", "500", "600", "700"],
  fallback: ["Georgia", "serif"],
});

// Configure body font - Alegreya for readable body text
const alegreya = Alegreya({
  variable: "--font-alegreya",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  weight: ["400", "500", "600", "700"],
  fallback: ["Georgia", "serif"],
});

// SEO metadata for BeauTeas
export const metadata: Metadata = {
  title: "BeauTeas - Build Your Beauty from Within",
  description: "Organic skincare teas designed to improve your beauty from within. USDA certified organic tea blends with calendula, chamomile, and more.",
  other: {
    // MCP Server Discovery
    "mcp-server": "/api/mcp",
    "mcp-schema": "/api/mcp/schema",
    "mcp-capabilities": "commerce,tea,skincare,organic,e-commerce",
    "mcp-version": "1.0.0",
  },
};

// Viewport configuration (separate export in Next.js 15+)
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

/**
 * Root layout component that wraps all application pages
 *
 * @param children - Page components to render within the layout
 * @returns Complete application layout with global providers
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#ebc3bb",
          colorTextOnPrimaryBackground: "#222222",
        },
      }}
    >
      <html lang="en" suppressHydrationWarning>
        <head>
          {/* MCP Server Discovery Meta Tags */}
          <meta name="mcp-server" content="/api/mcp" />
          <meta name="mcp-schema" content="/api/mcp/schema" />
          <meta name="mcp-capabilities" content="commerce,tea,skincare,organic,e-commerce" />
          <meta name="mcp-version" content="1.0.0" />
          <meta name="mcp-description" content="BeauTeas MCP Server for organic skincare tea commerce" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />

          {/* Additional MCP Discovery */}
          <link rel="mcp-server" href="/api/mcp" type="application/json" />
          <link rel="mcp-schema" href="/api/mcp/schema" type="application/json" />
        </head>
        <body
          className={`${lora.variable} ${alegreya.variable} antialiased bg-cream-100 text-charcoal flex flex-col min-h-screen font-body`}
          suppressHydrationWarning
        >
          {/* Promotional banner - shown above header when enabled */}
          <Suspense fallback={null}>
            <PromotionalBanner />
          </Suspense>

          {/* Global navigation header with suspense boundary */}
          <Suspense fallback={<div className="h-16 bg-neutral-900" />}>
            <Header />
          </Suspense>

          {/* Main content area - grows to fill available space */}
          <main className="flex-1" suppressHydrationWarning>
            {children}
          </main>

          {/* Global footer */}
          <Footer />

          {/* Global toast notification system */}
          <Toaster
            position="top-center"
            toastOptions={{
              className:
                "bg-blush-300 text-charcoal font-semibold rounded-md mt-[60px] shadow-lg animate-in fade-in slide-in-from-top-5",
              duration: 3000,
            }}
          />
          
          {/* Core Web Vitals monitoring */}
          <WebVitals />
        </body>
      </html>
    </ClerkProvider>
  );
}
