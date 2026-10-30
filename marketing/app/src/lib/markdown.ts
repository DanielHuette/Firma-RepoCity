// Renders post bodies and reports: CommonMark with tables, raw HTML switched off.
import MarkdownIt from "markdown-it";

const renderer = new MarkdownIt("default", { html: false, linkify: false, typographer: false });

export function renderMarkdown(text: string): string {
  return renderer.render(text);
}
