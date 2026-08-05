import {
  Bold,
  Code2,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Redo2,
  RemoveFormatting,
  Underline,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Email clients are far more reliable with web-safe stacks than webfonts. */
const FONTS = [
  { label: "Default", value: "" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times", value: "'Times New Roman', Times, serif" },
  { label: "Courier", value: "'Courier New', Courier, monospace" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
];

const SIZES = [
  { label: "Small", value: "13px" },
  { label: "Normal", value: "15px" },
  { label: "Medium", value: "17px" },
  { label: "Large", value: "20px" },
  { label: "Huge", value: "24px" },
];

const COLORS = [
  "#0B1520",
  "#5B6B7C",
  "#2049D6",
  "#0E8A6A",
  "#B4530A",
  "#A32B2B",
  "#7B3FE4",
  "#000000",
];

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  insertRef,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  /** Filled with a function that inserts text at the caret, for merge tags. */
  insertRef?: { current: ((text: string) => void) | null };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [showSource, setShowSource] = useState(false);

  // Writing innerHTML on every keystroke would reset the caret to the start, so
  // the DOM is only synced when the incoming value differs from what is shown.
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) el.innerHTML = value;
  }, [value]);

  const emit = useCallback(() => {
    if (ref.current) onChange(ref.current.innerHTML);
  }, [onChange]);

  /** Toolbar clicks steal focus, so the caret has to be remembered first. */
  const remember = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  const restore = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const range = savedRange.current;
    if (!range) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);

  const exec = useCallback(
    (command: string, arg?: string) => {
      restore();
      // Emits inline styles rather than legacy <font> tags — inline CSS is what
      // email clients handle consistently.
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand(command, false, arg);
      emit();
    },
    [restore, emit],
  );

  useEffect(() => {
    if (!insertRef) return;
    insertRef.current = (text: string) => {
      restore();
      document.execCommand("insertText", false, text);
      emit();
    };
    return () => {
      insertRef.current = null;
    };
  }, [insertRef, restore, emit]);

  function insertLink() {
    const url = window.prompt("Link URL", "https://");
    if (!url) return;
    exec("createLink", url);
  }

  function insertImage() {
    const url = window.prompt(
      "Image URL\n\nMust be a publicly reachable https:// address — most clients block images embedded in the message itself.",
      "https://",
    );
    if (!url) return;
    exec("insertImage", url);
  }

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface-muted px-2 py-1.5">
        <select
          aria-label="Font"
          className="h-7 rounded border border-border bg-card px-1.5 text-xs"
          defaultValue=""
          onMouseDown={remember}
          onChange={(e) => e.target.value && exec("fontName", e.target.value)}
        >
          {FONTS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Font size"
          className="h-7 rounded border border-border bg-card px-1.5 text-xs"
          defaultValue=""
          onMouseDown={remember}
          onChange={(e) => {
            if (!e.target.value) return;
            // execCommand fontSize only accepts 1-7, so the pixel value is
            // applied to the selection directly instead.
            restore();
            applyInlineStyle("fontSize", e.target.value);
            emit();
          }}
        >
          <option value="">Size</option>
          {SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <Divider />

        <ToolButton label="Bold" onMouseDown={remember} onClick={() => exec("bold")}>
          <Bold className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Italic" onMouseDown={remember} onClick={() => exec("italic")}>
          <Italic className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Underline" onMouseDown={remember} onClick={() => exec("underline")}>
          <Underline className="h-3.5 w-3.5" />
        </ToolButton>

        <Divider />

        <div className="flex items-center gap-0.5" onMouseDown={remember}>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Text colour ${c}`}
              title={c}
              onClick={() => exec("foreColor", c)}
              className="h-4 w-4 rounded-full border border-border"
              style={{ background: c }}
            />
          ))}
        </div>

        <Divider />

        <ToolButton
          label="Bulleted list"
          onMouseDown={remember}
          onClick={() => exec("insertUnorderedList")}
        >
          <List className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          label="Numbered list"
          onMouseDown={remember}
          onClick={() => exec("insertOrderedList")}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Insert link" onMouseDown={remember} onClick={insertLink}>
          <LinkIcon className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Insert image" onMouseDown={remember} onClick={insertImage}>
          <ImageIcon className="h-3.5 w-3.5" />
        </ToolButton>

        <Divider />

        <ToolButton label="Undo" onMouseDown={remember} onClick={() => exec("undo")}>
          <Undo2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label="Redo" onMouseDown={remember} onClick={() => exec("redo")}>
          <Redo2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton
          label="Clear formatting"
          onMouseDown={remember}
          onClick={() => exec("removeFormat")}
        >
          <RemoveFormatting className="h-3.5 w-3.5" />
        </ToolButton>

        <div className="ml-auto">
          <button
            type="button"
            title="Edit HTML source"
            aria-pressed={showSource}
            onClick={() => setShowSource((v) => !v)}
            className={cn(
              "flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors",
              showSource
                ? "bg-accent-blue text-primary-foreground"
                : "text-muted-foreground hover:bg-card hover:text-foreground",
            )}
          >
            <Code2 className="h-3.5 w-3.5" />
            HTML
          </button>
        </div>
      </div>

      {showSource ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          aria-label="HTML source"
          className="min-h-56 w-full resize-y bg-card px-3 py-2.5 font-mono text-xs leading-relaxed outline-none"
        />
      ) : (
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Email body"
          data-placeholder={placeholder ?? "Write your email…"}
          onInput={emit}
          onBlur={() => {
            remember();
            emit();
          }}
          onKeyUp={remember}
          onMouseUp={remember}
          className="min-h-56 px-3 py-2.5 text-sm leading-relaxed outline-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
        />
      )}
    </div>
  );
}

/** Wraps the current selection in a span carrying one inline style. */
function applyInlineStyle(prop: "fontSize", cssValue: string) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const span = document.createElement("span");
  span.style[prop] = cssValue;
  try {
    range.surroundContents(span);
  } catch {
    // surroundContents throws when the selection crosses element boundaries;
    // extracting and re-inserting handles that case.
    const contents = range.extractContents();
    span.appendChild(contents);
    range.insertNode(span);
  }
  sel.removeAllRanges();
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px bg-border" />;
}

function ToolButton({
  label,
  children,
  onClick,
  onMouseDown,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  onMouseDown: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // mousedown fires before focus moves, which is the only chance to record
      // where the caret was.
      onMouseDown={(e) => {
        e.preventDefault();
        onMouseDown();
      }}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
    >
      {children}
    </button>
  );
}
