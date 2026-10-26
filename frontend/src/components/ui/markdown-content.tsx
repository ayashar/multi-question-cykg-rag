import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

function splitTableRow(line: string): string[] {
  const value = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return value.split("|").map((cell) => cell.trim());
}

function isTableDelimiter(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isSafeHref(value: string): string | null {
  try {
    const url = new URL(value, "https://example.invalid");
    return ["http:", "https:"].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

function renderInline(value: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const tokenPattern = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^)]+\)|\*[^*\n]+\*|_[^_\n]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = tokenPattern.exec(value)) !== null) {
    if (match.index > lastIndex) parts.push(value.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(<code key={key++} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.9em]">{token.slice(1, -1)}</code>);
    } else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = link ? isSafeHref(link[2]) : null;
      parts.push(href ? <a key={key++} href={href} target="_blank" rel="noreferrer" className="underline decoration-primary-400 underline-offset-2">{link?.[1]}</a> : token);
    } else {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < value.length) parts.push(value.slice(lastIndex));
  return parts;
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index].trim();
  return Boolean(
    /^#{1,6}\s+/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    /^```/.test(line) ||
    /^([-*_])(?:\s*\1){2,}$/.test(line) ||
    (lines[index + 1] !== undefined && line.includes("|") && isTableDelimiter(lines[index + 1])),
  );
}

function MarkdownBlocks({ value }: { value: string }): ReactNode[] {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  let blockKey = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const Heading = `h${level}` as ElementType;
      blocks.push(<Heading key={blockKey++} className="mt-4 first:mt-0 font-h7 font-semibold">{renderInline(heading[2])}</Heading>);
      index += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(<pre key={blockKey++} data-language={language || undefined} className="overflow-x-auto rounded-[4px] bg-black/10 p-3 font-mono text-[0.9em]"><code>{code.join("\n")}</code></pre>);
      continue;
    }

    if (/^([-*_])(?:\s*\1){2,}$/.test(line)) {
      blocks.push(<hr key={blockKey++} className="my-3 border-neutral-400" />);
      index += 1;
      continue;
    }

    if (line.includes("|") && lines[index + 1] !== undefined && isTableDelimiter(lines[index + 1].trim())) {
      const header = splitTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(
        <div key={blockKey++} className="my-3 overflow-x-auto">
          <table className="min-w-full border-collapse text-left font-b2">
            <thead><tr>{header.map((cell, cellIndex) => <th key={cellIndex} className="border border-neutral-400 bg-black/10 px-2 py-1 font-semibold">{renderInline(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{header.map((_, cellIndex) => <td key={cellIndex} className="border border-neutral-300 px-2 py-1 align-top">{renderInline(row[cellIndex] ?? "")}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const unordered = line.match(/^[-*+]\s+(.+)$/);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const items: string[] = [];
      const orderedList = Boolean(ordered);
      while (index < lines.length) {
        const itemLine = lines[index].trim();
        const item = orderedList ? itemLine.match(/^\d+[.)]\s+(.+)$/) : itemLine.match(/^[-*+]\s+(.+)$/);
        if (!item) break;
        items.push(item[1]);
        index += 1;
      }
      const List = orderedList ? "ol" : "ul";
      blocks.push(<List key={blockKey++} className={cn("my-2 space-y-1 pl-5", orderedList ? "list-decimal" : "list-disc")}>{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</List>);
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={blockKey++} className="my-2 leading-relaxed">{renderInline(paragraph.join(" "))}</p>);
  }

  return blocks;
}

export default function MarkdownContent({ value, className }: { value: string; className?: string }) {
  return <div className={cn("wrap-anywhere", className)}>{MarkdownBlocks({ value })}</div>;
}
