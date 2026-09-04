function truncate(value, length) {
  const characters = Array.from(value);
  return characters.length <= length ? value : `${characters.slice(0, length - 1).join("")}…`;
}

export function markdownToPlainText(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/^\s*#{1,6}\s+/gmu, "")
    .replace(/^\s*[-+*]\s+\[[ xX]\]\s+/gmu, "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gmu, "")
    .replace(/^\s*>\s?/gmu, "")
    .replace(/[*_~`]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function notebookTitleFromMarkdown(content) {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || content;
  return truncate(markdownToPlainText(firstLine) || "未命名笔记", 120);
}

export function notebookSummaryFromMarkdown(content, titleWasProvided) {
  const lines = content
    .split(/\r?\n/)
    .map(markdownToPlainText)
    .filter(Boolean);
  const source = !titleWasProvided && lines.length > 1 ? lines.slice(1).join(" ") : lines.join(" ");
  return truncate(source || markdownToPlainText(content), 180);
}
