import {
  StarterKit,
  HorizontalRule,
  TiptapLink,
  TiptapImage,
  Placeholder,
  TaskList,
  TaskItem,
  TiptapUnderline,
  TextStyle,
  Color,
  HighlightExtension,
  CodeBlockLowlight,
  CustomKeymap,
  UpdatedImage,
  AIHighlight,
  UploadImagesPlugin,
} from "novel";
import { Extension } from "@tiptap/core";
import { common, createLowlight } from "lowlight";
import TextAlign from "@tiptap/extension-text-align";
import Typography from "@tiptap/extension-typography";
import CharacterCount from "@tiptap/extension-character-count";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import GlobalDragHandle from "tiptap-extension-global-drag-handle";

const lowlight = createLowlight(common);

const UploadImages = Extension.create({
  name: "uploadImages",
  addProseMirrorPlugins() {
    return [UploadImagesPlugin({ imageClass: "opacity-40" })];
  },
});

export const extensions: any[] = [
  StarterKit.configure({
    horizontalRule: false,
    codeBlock: false,
    heading: { levels: [1, 2, 3] },
  }),
  HorizontalRule,
  TiptapLink.configure({
    HTMLAttributes: { class: "text-secondary-600 underline cursor-pointer" },
    openOnClick: false,
  }),
  UpdatedImage.configure({ allowBase64: false }),
  UploadImages,
  Placeholder.configure({ placeholder: "Type '/' for commands..." }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TiptapUnderline,
  TextStyle,
  Color,
  HighlightExtension.configure({ multicolor: true }),
  CodeBlockLowlight.configure({ lowlight }),
  CustomKeymap,
  AIHighlight,
  TextAlign.configure({
    types: ["heading", "paragraph", "image"],
    alignments: ["left", "center", "right"],
    defaultAlignment: "left",
  }),
  Typography,
  CharacterCount.configure({}),
  Table.configure({
    resizable: true,
    HTMLAttributes: { class: "border-collapse my-4 w-full" },
  }),
  TableRow,
  TableHeader.configure({
    HTMLAttributes: { class: "border border-border-default bg-surface px-3 py-2 font-semibold text-left" },
  }),
  TableCell.configure({
    HTMLAttributes: { class: "border border-border-default px-3 py-2" },
  }),
  GlobalDragHandle.configure({ dragHandleWidth: 20, scrollTreshold: 100 }),
];
