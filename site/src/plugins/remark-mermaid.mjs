import { visit } from "unist-util-visit";

/**
 * Remark plugin: convert ```mermaid fenced code blocks into a raw
 * <pre class="mermaid"> element so the runtime mermaid.js loader (wired
 * via astro.config.mjs head) can pick them up and render SVG diagrams.
 *
 * Without this, Starlight's Expressive Code integration treats mermaid
 * source as a normal syntax-highlighted code block and the diagrams
 * never render — they ship as raw text.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default function remarkMermaid() {
  return (tree) => {
    visit(tree, "code", (node, index, parent) => {
      if (node.lang !== "mermaid" || !parent || typeof index !== "number") {
        return;
      }
      parent.children[index] = {
        type: "html",
        value: `<pre class="mermaid" data-mermaid>${escapeHtml(node.value)}</pre>`,
      };
    });
  };
}
