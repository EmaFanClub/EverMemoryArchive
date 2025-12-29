import coreSidebar from "../core/typedoc-sidebar.json";
import httpSidebar from "../http/typedoc-sidebar.json";

export default {
  lang: "en-US",
  title: "EverMemoryArchive",
  description:
    "EverMemoryArchive is a platform for creating and managing memory-based agents.",
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
            link: "/http",
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
