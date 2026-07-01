"use client";
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { AlignLeft, AlignCenter, AlignRight, Link2, Table as TableIcon, Plus, Minus, Trash2 } from "lucide-react";
import { promptForLink } from "./editorLinks";

const BTN = "flex h-8 w-8 items-center justify-center rounded text-text-secondary hover:bg-surface hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none";
const BTN_ACTIVE = "bg-primary-500/10 text-primary-600";
const DIVIDER = "mx-1 h-5 w-px bg-border-default";

export function EditorFormatToolbar({ editor }: { editor: Editor | null }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const tick = () => force((n) => n + 1);
    editor.on("selectionUpdate", tick);
    editor.on("transaction", tick);
    return () => { editor.off("selectionUpdate", tick); editor.off("transaction", tick); };
  }, [editor]);

  const inTable = editor?.isActive("table") ?? false;

  return (
    <div className="flex items-center gap-0.5 border-b border-border-default bg-white px-3 py-1">
      {/* Alignment */}
      <button type="button" onClick={() => editor?.chain().focus().setTextAlign("left").run()}
        className={`${BTN} ${editor?.isActive({ textAlign: "left" }) ? BTN_ACTIVE : ""}`} title="Align left">
        <AlignLeft className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => editor?.chain().focus().setTextAlign("center").run()}
        className={`${BTN} ${editor?.isActive({ textAlign: "center" }) ? BTN_ACTIVE : ""}`} title="Align center">
        <AlignCenter className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => editor?.chain().focus().setTextAlign("right").run()}
        className={`${BTN} ${editor?.isActive({ textAlign: "right" }) ? BTN_ACTIVE : ""}`} title="Align right">
        <AlignRight className="h-4 w-4" />
      </button>
      <div className={DIVIDER} />
      {/* Link */}
      <button type="button" onClick={() => promptForLink(editor ?? null)}
        className={`${BTN} ${editor?.isActive("link") ? BTN_ACTIVE : ""}`} title="Insert/edit link (⌘K)">
        <Link2 className="h-4 w-4" />
      </button>
      {/* Table */}
      <button type="button"
        onClick={() => (editor?.chain().focus() as any)?.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        className={BTN} title="Insert table">
        <TableIcon className="h-4 w-4" />
      </button>
      {inTable && (
        <>
          <div className={DIVIDER} />
          <button type="button" onClick={() => editor?.chain().focus().addColumnAfter().run()} className={BTN} title="Add column">
            <Plus className="h-3 w-3" />
          </button>
          <button type="button" onClick={() => editor?.chain().focus().deleteColumn().run()} className={BTN} title="Delete column">
            <Minus className="h-3 w-3" />
          </button>
          <button type="button" onClick={() => editor?.chain().focus().deleteTable().run()} className={BTN} title="Delete table">
            <Trash2 className="h-3 w-3" />
          </button>
        </>
      )}
    </div>
  );
}
