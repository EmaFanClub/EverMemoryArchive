import coreSidebar from "../core/typedoc-sidebar.json";

export default {
  lang: "en-US",
  title: "EverMemoryArchive",
  base: process.env.VITEPRESS_BASE ?? "/",
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
          {
            text: "Installation",
            link: "/installation",
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
        text: "API",
        items: [
          {
            text: "API Reference",
            link: "/api-reference/",
          },
        ],
      },
    ],
  },
  ignoreDeadLinks: [
    // ignore exact url "/playground"
    "/playground",
    // ignore all localhost links
    /^https?:\/\/localhost/,
    // ignore all links that include "/repl/"
    /\/repl\//,
  ],
};
