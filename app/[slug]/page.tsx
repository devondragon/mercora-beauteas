/**
 * Dynamic Page Route - Content Management System
 * 
 * Renders public pages by slug (e.g., /about, /privacy-policy, /terms-of-service).
 * Handles SEO metadata, custom CSS/JS, and responsive content display.
 */

import { Metadata } from "next";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { getPageBySlug } from "@/lib/models/pages";
import { SITE_NAME } from "@/lib/seo/metadata";
import { getCustomJsEnabled } from "@/lib/cms/custom-js-guard";
import PageRenderer from "./PageRenderer";
import { auth } from "@clerk/nextjs/server";
import { cmsTimestampToDate } from "@/lib/utils/date";

interface PageProps {
  params: Promise<{
    slug: string;
  }>;
}

/**
 * Generate metadata for the page (SEO)
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  try {
    const { slug } = await params;
    const page = await getPageBySlug(slug);
    
    if (!page) {
      return {
        title: "Page Not Found",
        description: "The requested page could not be found.",
      };
    }

    return {
      title: page.meta_title || page.title,
      description: page.meta_description || page.excerpt || `${page.title} - ${SITE_NAME}`,
      keywords: page.meta_keywords?.split(',').map((k: string) => k.trim()),
      openGraph: {
        title: page.meta_title || page.title,
        description: page.meta_description || page.excerpt || `${page.title} - ${SITE_NAME}`,
        type: 'article',
        publishedTime: cmsTimestampToDate(page.published_at ?? page.created_at).toISOString(),
        modifiedTime: cmsTimestampToDate(page.updated_at).toISOString(),
      },
      alternates: {
        canonical: `/${page.slug}`,
      },
    };
  } catch (error) {
    // A lookup failure is not the same as a missing page — claiming "Page Not
    // Found" here would mislabel a live page during a transient D1 error. The
    // page component itself decides the status code; this only avoids asserting
    // something untrue in the metadata.
    console.error("Error generating page metadata:", error);
    return { title: SITE_NAME };
  }
}

/**
 * Generate static params for known pages (optional optimization)
 */
export async function generateStaticParams() {
  try {
    // For now, return empty array to use dynamic rendering
    // In production, you might want to pre-generate static paths for published pages
    return [];
  } catch (error) {
    console.error("Error generating static params:", error);
    return [];
  }
}

/**
 * Page component
 */
export default async function PublicPage({ params }: PageProps) {
  try {
    const { slug } = await params;
    const page = await getPageBySlug(slug);
    
    if (!page) {
      notFound();
    }

    // Check if page is protected and requires authentication
    if (page.is_protected) {
      const { userId } = await auth();
      
      if (!userId) {
        // Redirect to sign-in with return URL
        redirect(`/sign-in?redirect_url=/${slug}`);
      }
    }

    // Kill switch (BMC-163): custom_js runs client-side only when the
    // `cms.custom_js_enabled` admin setting is explicitly enabled. Read it
    // server-side (D1) and thread the decision into the client component.
    const customJsEnabled = await getCustomJsEnabled();

    return <PageRenderer page={page} customJsEnabled={customJsEnabled} />;

  } catch (error) {
    // notFound() and redirect() work by throwing. Without this, the catch below
    // swallows them: a protected page's sign-in redirect became a 404 instead of
    // sending the visitor to /sign-in. unstable_rethrow re-throws Next's internal
    // control-flow errors and lets genuine failures fall through.
    // (unstable_rethrow is an unstable Next API — re-verify on major upgrades.)
    unstable_rethrow(error);

    // Everything reaching here is a real failure — a D1 error, a Clerk outage.
    // Do NOT notFound() it: a 404 is a claim that the page does not exist, and
    // Google acts on it. A transient blip would otherwise deindex live legal
    // pages. Rethrow so app/error.tsx renders a 500 instead.
    console.error("Error loading page:", error);
    throw error;
  }
}
