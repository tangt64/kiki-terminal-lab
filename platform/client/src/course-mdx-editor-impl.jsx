import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertCodeBlock,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  Separator,
  UndoRedo,
  codeBlockPlugin,
  diffSourcePlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from "@mdxeditor/editor";
import { useCallback, useEffect, useMemo, useRef } from "react";
import "@mdxeditor/editor/style.css";
import { normalizeMarkdownForMdxEditor } from "./markdown-mdx-safety.js";

function createCourseMarkdownPlugins() {
  return [
    headingsPlugin({ allowedHeadingLevels: [1, 2, 3, 4, 5, 6] }),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    tablePlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: "bash" }),
    markdownShortcutPlugin(),
    diffSourcePlugin({ viewMode: "rich-text", diffMarkdown: "" }),
    toolbarPlugin({
      toolbarContents: () => (
        <DiffSourceToggleWrapper>
          <UndoRedo />
          <Separator />
          <BlockTypeSelect />
          <BoldItalicUnderlineToggles />
          <ListsToggle options={["bullet", "number", "check"]} />
          <Separator />
          <CreateLink />
          <InsertTable />
          <InsertThematicBreak />
          <InsertCodeBlock />
        </DiffSourceToggleWrapper>
      ),
    }),
  ];
}

export default function CourseMdxEditorImpl({
  value,
  onChange,
  placeholder = "",
  minHeight = 420,
  compact = false,
}) {
  const editorRef = useRef(null);
  const lastMarkdownRef = useRef(normalizeMarkdownForMdxEditor(value));
  const markdown = normalizeMarkdownForMdxEditor(value);
  const plugins = useMemo(() => createCourseMarkdownPlugins(), []);

  useEffect(() => {
    if (markdown === lastMarkdownRef.current) return;
    lastMarkdownRef.current = markdown;
    editorRef.current?.setMarkdown(markdown);
  }, [markdown]);

  const handleChange = useCallback((nextMarkdown, initialMarkdownNormalize = false) => {
    const normalizedMarkdown = normalizeMarkdownForMdxEditor(nextMarkdown);

    if (normalizedMarkdown === lastMarkdownRef.current) return;
    lastMarkdownRef.current = normalizedMarkdown;

    if (initialMarkdownNormalize) return;
    onChange(normalizedMarkdown);
  }, [onChange]);

  return (
    <div
      className={`course-markdown-editor ${compact ? "is-compact" : ""}`.trim()}
      style={{ "--course-markdown-editor-min-height": `${minHeight}px` }}
    >
      <MDXEditor
        ref={editorRef}
        className="course-mdx-editor"
        contentEditableClassName="course-mdx-editor-content"
        markdown={markdown}
        onChange={handleChange}
        placeholder={placeholder}
        plugins={plugins}
      />
    </div>
  );
}
