/** One entry for every site page: <body data-page="…"> picks which. */
import { mount } from "./kit.jsx";

const page = document.body.dataset.page;
const load = {
  terminal: () => import("./terminal.jsx"),
  about: () => import("./pages.jsx").then((m) => ({ default: m.About })),
  news: () => import("./pages.jsx").then((m) => ({ default: m.News })),
  download: () => import("./pages.jsx").then((m) => ({ default: m.Download })),
  help: () => import("./pages.jsx").then((m) => ({ default: m.Help })),
}[page];

if (load) load().then(({ default: Page }) => mount(<Page />));
