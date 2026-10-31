import { Suspense, lazy, useMemo, useState } from "react";
import { summarizeMarkdownQuality } from "./markdown-mdx-safety.js";

export const COURSE_MARKDOWN_EDITOR_KIND = "mdxeditor";

const CourseMdxEditorImpl = lazy(() => import("./course-mdx-editor-impl.jsx"));

function SimpleMarkdownTextarea({ value, onChange, placeholder, minHeight = 360 }) {
  return (
    <textarea
      className="course-markdown-fallback"
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      style={{ minHeight }}
      value={value}
    />
  );
}

function CourseMarkdownModeBar({ mode, onSelectMode }) {
  return (
    <div className="course-markdown-modebar" role="group" aria-label="Markdown editor mode">
      <button
        className={mode === "markdown" ? "is-active" : ""}
        onClick={() => onSelectMode("markdown")}
        type="button"
      >
        Markdown
      </button>
      <button
        className={mode === "visual" ? "is-active" : ""}
        onClick={() => onSelectMode("visual")}
        type="button"
      >
        시각 편집
      </button>
    </div>
  );
}

function CourseMarkdownStatus({ summary }) {
  const tone = summary.warnings.length ? "is-warning" : summary.lines ? "is-ready" : "is-muted";

  return (
    <div className={`course-markdown-status ${tone}`} aria-label="Markdown content status">
      <strong>{summary.status}</strong>
      <span>{`줄 ${summary.lines}`}</span>
      <span>{`제목 ${summary.headingCount}`}</span>
      <span>{`코드 ${summary.codeBlockCount}`}</span>
      {summary.warnings.map((warning) => (
        <em key={warning}>{warning}</em>
      ))}
    </div>
  );
}

export default function CourseMarkdownEditor({
  value,
  onChange,
  placeholder = "",
  minHeight = 420,
  compact = false,
  fallback = false,
  preferVisual = false,
}) {
  const [visualEditorOpen, setVisualEditorOpen] = useState(Boolean(preferVisual));
  const markdownValue = String(value || "");
  const markdownSummary = useMemo(() => summarizeMarkdownQuality(markdownValue), [markdownValue]);

  if (fallback) {
    return (
      <SimpleMarkdownTextarea
        minHeight={minHeight}
        onChange={onChange}
        placeholder={placeholder}
        value={markdownValue}
      />
    );
  }

  if (!visualEditorOpen) {
    return (
      <div className={`course-markdown-editor-shell ${compact ? "is-compact" : ""}`.trim()}>
        <CourseMarkdownModeBar mode="markdown" onSelectMode={(mode) => setVisualEditorOpen(mode === "visual")} />
        <CourseMarkdownStatus summary={markdownSummary} />
        <SimpleMarkdownTextarea
          minHeight={minHeight}
          onChange={onChange}
          placeholder={placeholder}
          value={markdownValue}
        />
      </div>
    );
  }

  return (
    <div className={`course-markdown-editor-shell ${compact ? "is-compact" : ""}`.trim()}>
      <CourseMarkdownModeBar mode="visual" onSelectMode={(mode) => setVisualEditorOpen(mode === "visual")} />
      <CourseMarkdownStatus summary={markdownSummary} />
      <Suspense
        fallback={(
          <div className="course-markdown-editor is-loading" style={{ "--course-markdown-editor-min-height": `${minHeight}px` }}>
            <span>교재 편집기를 준비하고 있습니다.</span>
          </div>
        )}
      >
        <CourseMdxEditorImpl
          compact={compact}
          minHeight={minHeight}
          onChange={onChange}
          placeholder={placeholder}
          value={value}
        />
      </Suspense>
    </div>
  );
}
