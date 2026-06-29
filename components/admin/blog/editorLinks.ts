import type { Editor } from "@tiptap/core";

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^(https?:|mailto:|tel:|\/)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function promptForLink(editor: Editor | null): void {
  if (!editor) return;
  const currentHref = (editor.getAttributes("link") as { href?: string } | undefined)?.href ?? "";
  const input = window.prompt(
    currentHref ? "Edit link URL (leave blank to remove)" : "Enter URL",
    currentHref,
  );
  if (input === null) return;
  const url = normalizeUrl(input);
  // cast: setLink/unsetLink are added by TiptapLink extension, not in base ChainedCommands type
  const chain = editor.chain().focus().extendMarkRange("link") as any;
  if (!url) { chain.unsetLink().run(); return; }
  chain.setLink({ href: url }).run();
}
