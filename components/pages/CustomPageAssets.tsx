"use client";

import { useEffect } from "react";

/**
 * Client-side injection of admin-authored per-page CSS/JS.
 *
 * Split out of PageRenderer so that component can be a server component. The
 * BMC-163 guardrail is unchanged: `custom_js` is executed via `new Function()`
 * ONLY when `customJsEnabled` is explicitly true, so a missing or omitted flag
 * never runs the code.
 */
interface CustomPageAssetsProps {
  pageId: number;
  customCss: string | null;
  customJs: string | null;
  customJsEnabled: boolean;
}

export default function CustomPageAssets({
  pageId,
  customCss,
  customJs,
  customJsEnabled,
}: CustomPageAssetsProps) {
  useEffect(() => {
    if (!customCss) return;
    const styleElement = document.createElement("style");
    styleElement.id = `page-${pageId}-styles`;
    styleElement.textContent = customCss;
    document.head.appendChild(styleElement);
    return () => {
      document.getElementById(`page-${pageId}-styles`)?.remove();
    };
  }, [customCss, pageId]);

  useEffect(() => {
    if (!customJsEnabled || !customJs) return;
    try {
      new Function(customJs)();
    } catch (error) {
      console.error("Error executing custom JavaScript for page:", error);
    }
  }, [customJs, customJsEnabled]);

  return null;
}
