import type { PluginModule } from "../../plugins/api";
import { gitHubCli } from "../github/gh";
import { ReviewsPage } from "./ReviewsPage";
import { reviewCache } from "./storage";
import { createReviewSync } from "./sync";

export const inject = ["pages", "host"];

export const apply: PluginModule["apply"] = (ctx) => {
  const reviews = createReviewSync(gitHubCli(ctx.host), reviewCache());
  ctx.effect(() => {
    void reviews.sync();
    const timer = setInterval(() => void reviews.sync(), 5 * 60_000);
    return () => {
      clearInterval(timer);
      reviews.dispose();
    };
  });
  ctx.pages.register({
    id: "reviews",
    title: "Reviews",
    layout: "workspace",
    primary: true,
    placement: "sidebar",
    component: () => <ReviewsPage reviews={reviews} />,
  });
};
