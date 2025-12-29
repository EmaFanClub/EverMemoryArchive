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
        text: "Http APIs",
        items: [
          {
            text: "Guide",
            link: "/http",
          },
          ...httpSidebar,
        ],
      }
    ],
  },
  ignoreDeadLinks: [
    // ignore exact url "/playground"
    '/playground',
    // ignore all localhost links
    /^https?:\/\/localhost/,
    // ignore all links include "/repl/""
    /\/repl\//,
  ]
};
