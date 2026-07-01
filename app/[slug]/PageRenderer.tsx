/**
 * Page Renderer Component - Content Management System
 * 
 * Renders the content of a CMS page with proper styling, custom CSS/JS,
 * and responsive design. Handles different page templates and layouts.
 */

"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PageSelect } from "@/lib/db/schema/pages";
import { Calendar, User } from "lucide-react";

interface PageRendererProps {
  page: PageSelect;
}

export default function PageRenderer({ page }: PageRendererProps) {
  // Inject custom CSS and JS if present
  useEffect(() => {
    // Handle custom CSS
    if (page.custom_css) {
      const styleElement = document.createElement('style');
      styleElement.id = `page-${page.id}-styles`;
      styleElement.textContent = page.custom_css;
      document.head.appendChild(styleElement);

      // Cleanup on unmount
      return () => {
        const existingStyle = document.getElementById(`page-${page.id}-styles`);
        if (existingStyle) {
          existingStyle.remove();
        }
      };
    }
  }, [page.custom_css, page.id]);

  useEffect(() => {
    // Handle custom JavaScript
    if (page.custom_js) {
      try {
        const scriptFunction = new Function(page.custom_js);
        scriptFunction();
      } catch (error) {
        console.error("Error executing custom JavaScript for page:", error);
      }
    }
  }, [page.custom_js]);

  // Format date for display. Dates are stored as Unix timestamps (seconds) in D1,
  // so multiply by 1000 to convert to milliseconds before constructing a Date.
  const formatDate = (dateValue: string | number): string | null => {
    const ms = typeof dateValue === 'number' ? dateValue * 1000 : Number(dateValue) * 1000;
    const date = new Date(ms);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Get page template styling
  const getTemplateClasses = (template: string) => {
    switch (template) {
      case 'legal':
        return {
          container: 'max-w-4xl',
          content: 'prose max-w-none prose-headings:text-text-primary prose-p:text-text-secondary prose-li:text-text-secondary prose-a:text-primary-600 prose-strong:text-text-primary',
          header: 'border-b border-border-default pb-6 mb-8'
        };
      case 'about':
        return {
          container: 'max-w-6xl',
          content: 'prose max-w-none prose-headings:text-text-primary prose-p:text-text-secondary prose-li:text-text-secondary prose-a:text-primary-600 prose-strong:text-text-primary',
          header: 'text-center pb-8 mb-12 border-b border-border-default'
        };
      default:
        return {
          container: 'max-w-4xl',
          content: 'prose max-w-none prose-headings:text-text-primary prose-p:text-text-secondary prose-li:text-text-secondary prose-a:text-primary-600 prose-strong:text-text-primary',
          header: 'pb-6 mb-8'
        };
    }
  };

  const templateClasses = getTemplateClasses(page.template || 'default');

  return (
    <>
      {/* Background Pattern - only for this page content area */}
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_30%_80%,rgba(207,133,119,0.1),transparent_50%),radial-gradient(circle_at_80%_20%,rgba(207,133,119,0.05),transparent_50%)] pointer-events-none -z-10" />

      {/* Page Content */}
      <div className="container mx-auto px-4 py-12 relative">
          <div className={`mx-auto ${templateClasses.container}`}>
            {/* Page Header */}
            <div className={templateClasses.header}>
              <h1 className="text-4xl md:text-5xl font-bold text-text-primary mb-4">
                {page.title}
              </h1>

              {page.excerpt && (
                <p className="text-xl text-text-secondary mb-6">
                  {page.excerpt}
                </p>
              )}

              {/* Page Meta Information */}
              <div className="flex flex-wrap items-center gap-6 text-sm text-text-muted">
                {page.published_at && formatDate(page.published_at) && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    <span>Published {formatDate(page.published_at)}</span>
                  </div>
                )}

                {page.updated_at && page.updated_at !== page.created_at && formatDate(page.updated_at) && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    <span>Updated {formatDate(page.updated_at)}</span>
                  </div>
                )}

                {page.version > 1 && (
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    <span>Version {page.version}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Page Content */}
            <div 
              className={templateClasses.content}
              dangerouslySetInnerHTML={{ __html: page.content }}
            />

            {/* Page Footer */}
            {(page.template || 'default') === 'legal' && (
              <div className="mt-12 pt-8 border-t border-border-default">
                <div className="bg-white border border-border-default rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-text-primary mb-2">Need Help?</h3>
                  <p className="text-text-secondary mb-4">
                    If you have any questions about this document or our policies,
                    please don&rsquo;t hesitate to contact us.
                  </p>
                  <div className="flex flex-wrap gap-4">
                    <a
                      href="mailto:hello@beauteas.com"
                      className="text-primary-700 hover:text-primary-800 transition-colors"
                    >
                      Contact Support
                    </a>
                    <Link
                      href="/about"
                      className="text-primary-700 hover:text-primary-800 transition-colors"
                    >
                      About Us
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Related Pages or CTA Section (for about page) */}
        {(page.template || 'default') === 'about' && (
          <div className="bg-gradient-to-r from-primary-100 to-secondary-100 py-16 mt-16">
            <div className="container mx-auto px-4">
              <div className="max-w-4xl mx-auto text-center">
                <h2 className="text-3xl font-bold text-text-primary mb-6">
                  Ready to Explore?
                </h2>
                <p className="text-xl text-text-secondary mb-8">
                  Discover our AI-powered tea recommendations and start building your beauty from within.
                </p>
                <div className="flex flex-wrap justify-center gap-4">
                  <Link
                    href="/products"
                    className="bg-primary-500 hover:bg-primary-600 text-text-inverse px-8 py-3 rounded-lg font-semibold transition-colors"
                  >
                    Shop Products
                  </Link>
                  <Link
                    href="/agent"
                    className="bg-transparent border-2 border-primary-500 text-primary-600 hover:bg-primary-500 hover:text-text-inverse px-8 py-3 rounded-lg font-semibold transition-colors"
                  >
                    Chat with Chai AI
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
  );
}
