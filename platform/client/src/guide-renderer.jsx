import { useState } from "react";

const MARKDOWN_ESCAPED_CHAR_PATTERN = /\\([\\`*{}[\]()#+\-.!_>|~])/g;

function unescapeInlineMarkdownText(text) {
  return String(text || "").replace(MARKDOWN_ESCAPED_CHAR_PATTERN, "$1");
}

function renderInlineMarkdown(text) {
  const value = String(text || "");
  const parts = value.split(/(`[^`]+`)/g);
  return parts.flatMap((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return part.split(/(\*\*[^*]+\*\*)/g).map((chunk, chunkIndex) => {
      if (chunk.startsWith("**") && chunk.endsWith("**")) {
        return <strong key={`${index}-${chunkIndex}`}>{unescapeInlineMarkdownText(chunk.slice(2, -2))}</strong>;
      }
      return unescapeInlineMarkdownText(chunk);
    });
  });
}

function slugifyHeading(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(MARKDOWN_ESCAPED_CHAR_PATTERN, "$1")
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export default function GuideMarkdownBlock({ source, showToc = false }) {
  const [copiedKey, setCopiedKey] = useState("");
  const lines = String(source || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  const toc = [];
  let paragraph = [];
  let listItems = [];
  let listType = "ul";
  let codeLines = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: "p", text: paragraph.join(" ") });
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push({ type: listType, items: [...listItems] });
    listItems = [];
    listType = "ul";
  };

  const flushCode = () => {
    if (!codeLines.length) return;
    blocks.push({ type: "code", code: codeLines.join("\n") });
    codeLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine ?? "";
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const text = heading[2];
      const id = `guide-${slugifyHeading(text)}-${blocks.length}`;
      blocks.push({ type: "heading", level: heading[1].length, text, id });
      toc.push({ level: heading[1].length, text, id });
      continue;
    }

    const unorderedListItem = trimmed.match(/^[-*]\s+(.*)$/);
    if (unorderedListItem) {
      if (listItems.length && listType !== "ul") flushList();
      flushParagraph();
      listType = "ul";
      listItems.push(unorderedListItem[1]);
      continue;
    }

    const orderedListItem = trimmed.match(/^\d+\.\s+(.*)$/);
    if (orderedListItem) {
      if (listItems.length && listType !== "ol") flushList();
      flushParagraph();
      listType = "ol";
      listItems.push(orderedListItem[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushCode();

  if (!blocks.length) {
    return <p className="hint">표시할 내용이 없습니다.</p>;
  }

  return (
    <div className={`markdown-guide-shell ${showToc ? "has-toc" : ""}`}>
      {showToc && toc.length ? (
        <aside className="guide-toc">
          <strong>목차</strong>
          <div className="guide-toc-list">
            {toc.map((item) => (
              <a key={item.id} className={`guide-toc-item level-${item.level}`} href={`#${item.id}`}>
                {unescapeInlineMarkdownText(item.text)}
              </a>
            ))}
          </div>
        </aside>
      ) : null}

      <div className="markdown-guide">
        {blocks.map((block, index) => {
          if (block.type === "heading") {
            if (block.level === 1) return <h4 id={block.id} key={index}>{unescapeInlineMarkdownText(block.text)}</h4>;
            if (block.level === 2) return <h5 id={block.id} key={index}>{unescapeInlineMarkdownText(block.text)}</h5>;
            return <h6 id={block.id} key={index}>{unescapeInlineMarkdownText(block.text)}</h6>;
          }

          if (block.type === "ul" || block.type === "ol") {
            const ListTag = block.type;
            return (
              <ListTag key={index} className="detail-list">
                {block.items.map((item) => <li key={`${index}-${item}`}>{renderInlineMarkdown(item)}</li>)}
              </ListTag>
            );
          }

          if (block.type === "code") {
            const copyKey = String(index);
            return (
              <div key={index} className="markdown-code-wrap">
                <div className="markdown-code-toolbar">
                  <button
                    className="mini-btn"
                    onClick={async () => {
                      await navigator.clipboard?.writeText(block.code);
                      setCopiedKey(copyKey);
                      window.setTimeout(() => {
                        setCopiedKey((current) => (current === copyKey ? "" : current));
                      }, 1500);
                    }}
                    type="button"
                  >
                    {copiedKey === copyKey ? "복사됨" : "복사"}
                  </button>
                </div>
                <pre className="markdown-code">
                  <code>{block.code}</code>
                </pre>
              </div>
            );
          }

          return <p key={index}>{renderInlineMarkdown(block.text)}</p>;
        })}
      </div>
    </div>
  );
}
