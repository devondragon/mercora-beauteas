/**
 * === Admin Header Component ===
 *
 * Top navigation bar for the admin interface featuring breadcrumbs,
 * page titles, and admin-specific controls.
 *
 * === Features ===
 * - **Breadcrumb Navigation**: Dynamic breadcrumbs based on current route
 * - **Page Titles**: Automatic page title display
 * - **Responsive Design**: Mobile-friendly layout
 * - **Professional Styling**: Admin-optimized header design
 * - **User Context**: Placeholder for user info (no auth for now)
 *
 * === Components ===
 * - Breadcrumbs: Hierarchical navigation
 * - Page Title: Current page identifier
 * - User Actions: Placeholder for future user controls
 *
 * === Usage ===
 * Used within AdminLayout to provide top navigation
 */

"use client";

import Link from "next/link";
import { useAdminLayout } from "./AdminLayoutProvider";
import { 
  ChevronRight,
  User,
  Bell,
  Search
} from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Admin Header Component
 */
export default function AdminHeader() {
  const { breadcrumbs, pageTitle, sidebarCollapsed } = useAdminLayout();

  return (
    <header className={`
      admin-header border-b transition-all duration-300
      ${sidebarCollapsed ? 'md:pl-16' : 'md:pl-64'}
    `}>
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          
          {/* Left Section: Breadcrumbs and Title */}
          <div className="flex-1">
            {/* Breadcrumbs */}
            <nav className="flex items-center space-x-2 text-sm mb-1">
              {breadcrumbs.map((item, index) => (
                <div key={item.href} className="flex items-center">
                  {index > 0 && (
                    <ChevronRight className="w-3 h-3 text-text-muted mx-2" />
                  )}

                  {item.current ? (
                    <span className="text-primary-600 font-medium">
                      {item.label}
                    </span>
                  ) : (
                    <Link
                      href={item.href}
                      className="text-text-secondary hover:text-text-primary transition-colors"
                    >
                      {item.label}
                    </Link>
                  )}
                </div>
              ))}
            </nav>

            {/* Page Title */}
            <h1 className="text-2xl font-bold text-text-primary">
              {pageTitle}
            </h1>
          </div>

          {/* Right Section: Actions and User */}
          <div className="flex items-center space-x-4">
            
            {/* Search Button (placeholder) */}
            <Button
              variant="ghost"
              size="sm"
              className="text-text-secondary hover:text-text-primary"
              disabled
            >
              <Search className="w-4 h-4" />
              <span className="sr-only">Search</span>
            </Button>

            {/* Notifications (placeholder) */}
            <Button
              variant="ghost"
              size="sm"
              className="text-text-secondary hover:text-text-primary relative"
              disabled
            >
              <Bell className="w-4 h-4" />
              {/* Notification badge placeholder */}
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-state-error rounded-full text-xs"></span>
              <span className="sr-only">Notifications</span>
            </Button>

            {/* User Menu (placeholder) */}
            <div className="flex items-center space-x-3 pl-4 border-l border-border-default">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-surface rounded-full flex items-center justify-center">
                  <User className="w-4 h-4 text-text-secondary" />
                </div>
                <div className="hidden md:block">
                  <div className="text-sm font-medium text-text-primary">Admin User</div>
                  <div className="text-xs text-text-secondary">admin@beauteas.com</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}