import coreSidebar from "../core/typedoc-sidebar.json";
import httpSidebar from "../http/typedoc-sidebar.json";

export default {
  lang: "en-US",
  title: "EverMemoryArchive",
  description:
    "EverMemoryArchive is a platform for creating and managing memory-based agents.",
  head: [
    ...mermaidHead()
  ],
  themeConfig: {
    sidebar: [
      // overview
      {
        text: "Getting Started",
        items: [
          {
            text: "Introduction",
            link: "/",
          },
        ],
      },
      {
        text: "Core References",
        items: [
          {
            text: "Guide",
            link: "/core",
          },
          ...coreSidebar,
        ],
      },
      {
        text: "HTTP Endpoints",
        items: [
          {
            text: "Guide",
            link: "/http-server",
          },
          ...flatHttpSidebar(httpSidebar),
        ],
      }
    ],
  },
  ignoreDeadLinks: [
    // ignore exact url "/playground"
    '/playground',
    // ignore all localhost links
    /^https?:\/\/localhost/,
    // ignore all links that include "/repl/"
    /\/repl\//,
  ]
};

function mermaidHead() {
  return [
    [
      'script',
      {
        id: 'mermaid-js',
        src: 'https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js',
        async: true,
      }
    ],
    [
      'script',
      {},
      `;(() => {
const mermaidJS = document.getElementById('mermaid-js');
document.addEventListener('DOMContentLoaded', async () => {
  await mermaidJS.ready;
  const isDark = document.documentElement.classList.contains('dark');
  mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'neutral' });
  const mermaidElements = document.getElementsByClassName('language-mermaid');
  for (const code of mermaidElements) {
    const preCode = code.querySelector('pre code');
    if (preCode) {
      const codeText = preCode.textContent;
      const randomId = "mermaid-" + Math.random().toString(36).substring(2, 15);
      const {svg} = await mermaid.render(randomId, codeText);
      code.innerHTML = svg;
    }
  }
});
})()`
    ]
  ];
}

function flatHttpSidebar(sidebar) {
  const routes = [];
  walk([], sidebar);
  return routes;
  function walk(path, items) {
    for (const item of items) {
      if (item.text === 'route') {
        if (item.items.length !== 1) {
          throw new Error(`Route ${item.text} must have exactly one item`);
        }
        item.text = `api/${path.join('/')}`;
        item.items = item.items[0].items;
        for (const endpoint of item.items) {
          endpoint.text = `${item.text}@${endpoint.text}`;
        }
        routes.push(item);
      } else {
        if (item.items) {
          walk([...path, item.text], item.items);
        }
      }
    }
  }
}
