"use client";

import {
  Bold,
  Code2,
  Heading2,
  Link2,
  List,
  ListChecks,
  Quote
} from "lucide-react";
import CharacterCount from "@tiptap/extension-character-count";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmitShortcut?: () => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  autoFocus?: boolean;
  ariaLabel?: string;
};

type FormatAction =
  | "heading"
  | "bold"
  | "list"
  | "checklist"
  | "quote"
  | "link"
  | "code";

const formatButtons: Array<{
  action: FormatAction;
  label: string;
  icon: ReactNode;
}> = [
  { action: "heading", label: "标题", icon: <Heading2 size={14} /> },
  { action: "bold", label: "加粗", icon: <Bold size={14} /> },
  { action: "list", label: "项目列表", icon: <List size={14} /> },
  { action: "checklist", label: "待办清单", icon: <ListChecks size={14} /> },
  { action: "quote", label: "引用", icon: <Quote size={14} /> },
  { action: "link", label: "链接", icon: <Link2 size={14} /> },
  { action: "code", label: "行内代码", icon: <Code2 size={14} /> }
];

export function MarkdownContent({
  content,
  emptyText = "写下一些内容后，就能在这里预览。"
}: {
  content: string;
  emptyText?: string;
}) {
  if (!content.trim()) {
    return <p className="markdown-empty">{emptyText}</p>;
  }

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener">{children}</a>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function MarkdownEditor({
  value,
  onChange,
  onSubmitShortcut,
  placeholder = "写下内容……",
  rows = 8,
  maxLength = 10_000,
  autoFocus = false,
  ariaLabel = "Markdown 正文"
}: MarkdownEditorProps) {
  const [, setRevision] = useState(0);
  const editor = useEditor({
    immediatelyRender: false,
    content: value,
    contentType: "markdown",
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https"
        }
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
        a11y: {
          checkboxLabel: (_node, checked) => checked ? "标记为未完成" : "标记为已完成"
        }
      }),
      CharacterCount.configure({ limit: maxLength }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } })
    ],
    editorProps: {
      attributes: {
        class: "markdown-rich-content",
        role: "textbox",
        "aria-label": ariaLabel,
        "aria-multiline": "true"
      },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          onSubmitShortcut?.();
          return true;
        }
        return false;
      }
    },
    onUpdate: ({ editor: activeEditor }) => onChange(activeEditor.getMarkdown()),
    onSelectionUpdate: () => setRevision((value) => value + 1)
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getMarkdown();
    if (current !== value) {
      editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
    }
  }, [editor, value]);

  useEffect(() => {
    if (autoFocus && editor) editor.commands.focus("end");
  }, [autoFocus, editor]);

  const format = (action: FormatAction) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    switch (action) {
      case "heading":
        chain.toggleHeading({ level: 2 }).run();
        break;
      case "bold":
        chain.toggleBold().run();
        break;
      case "list":
        chain.toggleBulletList().run();
        break;
      case "checklist":
        chain.toggleTaskList().run();
        break;
      case "quote":
        chain.toggleBlockquote().run();
        break;
      case "link":
        const previousUrl = editor.getAttributes("link").href as string | undefined;
        const url = window.prompt("输入链接地址", previousUrl || "https://");
        if (url === null) break;
        if (!url.trim()) chain.extendMarkRange("link").unsetLink().run();
        else chain.extendMarkRange("link").setLink({ href: url.trim() }).run();
        break;
      case "code":
        chain.toggleCode().run();
        break;
    }
  };

  const isActive = (action: FormatAction) => {
    if (!editor) return false;
    if (action === "heading") return editor.isActive("heading", { level: 2 });
    if (action === "list") return editor.isActive("bulletList");
    if (action === "checklist") return editor.isActive("taskList");
    if (action === "quote") return editor.isActive("blockquote");
    if (action === "link") return editor.isActive("link");
    return editor.isActive(action);
  };

  return (
    <div className={`markdown-editor ${!value.trim() ? "is-empty" : ""}`}>
      <div className="markdown-editor-bar">
        <div className="markdown-tools" role="toolbar" aria-label="文字格式">
          {formatButtons.map((button) => (
            <button
              key={button.action}
              type="button"
              className={isActive(button.action) ? "active" : ""}
              aria-label={button.label}
              aria-pressed={isActive(button.action)}
              title={button.label}
              disabled={!editor}
              onClick={() => format(button.action)}
            >
              {button.icon}
            </button>
          ))}
        </div>
        <span className="markdown-live-label"><span /> 即时排版</span>
      </div>

      <div className="markdown-rich-editor" style={{ minHeight: `${Math.max(rows * 1.75, 10)}em` }}>
        <EditorContent editor={editor} />
        {!value.trim() && <p className="markdown-placeholder">{placeholder}</p>}
      </div>

      <div className="markdown-editor-hint">
        <span>输入即排版</span>
        <span>* + 空格：列表 · # + 空格：标题 · [ ] + 空格：清单</span>
      </div>
    </div>
  );
}
