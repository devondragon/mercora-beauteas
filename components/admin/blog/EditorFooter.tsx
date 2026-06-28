"use client";
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { Sparkles } from "lucide-react";

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-neutral-600 bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-amber-400">
      {children}
    </kbd>
  );
}

export function EditorFooter({ editor }: { editor: Editor | null }) {
  const [counts, setCounts] = useState({ words: 0, chars: 0 });

  useEffect(() => {
    if (!editor) return;
    function update() {
      if (!editor) return;
      const storage = (editor.storage as { characterCount?: { words: () => number; characters: () => number } })
        .characterCount;
      if (!storage) return;
      setCounts({ words: storage.words(), chars: storage.characters() });
    }
    update();
    editor.on("update", update);
    editor.on("selectionUpdate", update);
    return () => { editor.off("update", update); editor.off("selectionUpdate", update); };
  }, [editor]);

  return (
    <div className="flex items-center justify-between border-t border-neutral-800 bg-neutral-950 px-4 py-2 text-xs text-neutral-500">
      <div className="flex items-center gap-3 flex-wrap">
        <span><Kbd>/</Kbd> commands</span>
        <span><Kbd>Tab</Kbd><Kbd>Tab</Kbd> <Sparkles className="inline h-3 w-3 text-amber-400" /> AI suggest</span>
        <span><Kbd>⌘K</Kbd> link</span>
      </div>
      <span className="shrink-0">{counts.words} words · {counts.chars} chars</span>
    </div>
  );
}
