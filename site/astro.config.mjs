// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import remarkMermaid from "./src/plugins/remark-mermaid.mjs";

export default defineConfig({
  site: "https://kibadist.github.io",
  base: "/agentui",
  trailingSlash: "ignore",
  markdown: {
    remarkPlugins: [remarkMermaid],
  },
  integrations: [
    starlight({
      title: "AgentUI",
      description:
        "An AI-native component system for agent-driven UIs. Typed UIEvents over SSE, validated server-side, rendered through a whitelisted React registry.",
      head: [
        {
          tag: "script",
          attrs: { type: "module" },
          // Load mermaid from a CDN and render any <pre class="mermaid">
          // emitted by the remark-mermaid plugin. Theme tracks Starlight's
          // `data-theme` attribute on <html>.
          content: `
            import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
            const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";
            async function render() {
              mermaid.initialize({ startOnLoad: false, theme: isDark() ? "dark" : "default", securityLevel: "loose" });
              const nodes = document.querySelectorAll("pre.mermaid[data-mermaid]");
              if (nodes.length === 0) return;
              // mermaid.run mutates the elements in place, replacing source
              // text with an SVG. Mark processed nodes so a theme-toggle
              // re-render starts from the raw source.
              for (const node of nodes) {
                if (!node.dataset.source) node.dataset.source = node.textContent ?? "";
                node.textContent = node.dataset.source;
                node.removeAttribute("data-processed");
              }
              await mermaid.run({ nodes });
            }
            render();
            // Re-render when the user toggles light/dark.
            new MutationObserver((mutations) => {
              if (mutations.some((m) => m.attributeName === "data-theme")) render();
            }).observe(document.documentElement, { attributes: true });
          `,
        },
      ],
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: true,
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/kibadist/agentui",
        },
      ],
      editLink: {
        baseUrl: "https://github.com/kibadist/agentui/edit/main/site/",
      },
      customCss: ["./src/styles/theme.css"],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Introduction", link: "/" },
            { label: "Getting started", slug: "getting-started" },
            { label: "Concepts", slug: "concepts" },
            { label: "Wire protocol", slug: "wire-protocol" },
            { label: "Example", slug: "examples" },
          ],
        },
        {
          label: "Packages",
          items: [
            { label: "Overview", slug: "packages" },
          ],
        },
        {
          label: "Guides — Client",
          collapsed: true,
          items: [
            { label: "<AgentRoot>", slug: "guides/agent-root" },
            { label: "Renderer", slug: "guides/renderer" },
            { label: "State selectors", slug: "guides/state-selectors" },
            { label: "Custom wire events", slug: "guides/custom-wire-events" },
            { label: "Tool calls", slug: "guides/tool-calls" },
            { label: "Reasoning", slug: "guides/reasoning" },
            { label: "Workflows", slug: "guides/workflows" },
            { label: "Optimistic updates", slug: "guides/optimistic" },
            { label: "Schema-first nodes", slug: "guides/schema-first-nodes" },
            { label: "Stream resilience", slug: "guides/stream-resilience" },
            { label: "Memory caps & metrics", slug: "guides/memory-caps" },
            { label: "Testing", slug: "guides/testing" },
            { label: "DevTools", slug: "guides/devtools" },
          ],
        },
        {
          label: "Guides — Server",
          collapsed: true,
          items: [
            { label: "Server companion (Node)", slug: "guides/server-node" },
            { label: "LLM adapters", slug: "guides/llm-adapters" },
            { label: "JSON Schema export", slug: "guides/json-schema-export" },
          ],
        },
        {
          label: "Guides — SVG components",
          collapsed: true,
          items: [
            { label: "SVG Agent UI components", slug: "guides/svg-components" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Use cases", slug: "use-cases" },
            { label: "Roadmap", slug: "roadmap" },
            {
              label: "Stability policy",
              link: "https://github.com/kibadist/agentui/blob/main/STABILITY.md",
            },
            {
              label: "Migration: 0.x → 1.0",
              link: "https://github.com/kibadist/agentui/blob/main/MIGRATION-1.0.md",
            },
            {
              label: "Changelog",
              link: "https://github.com/kibadist/agentui/blob/main/CHANGELOG.md",
            },
          ],
        },
      ],
    }),
  ],
});
