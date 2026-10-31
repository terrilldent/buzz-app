import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/wght.css";
import "../../src/shared/styles/globals.css";
import { ReviewsPage } from "../../src/bundled/reviews/ReviewsPage";
import { createReviewSync } from "../../src/bundled/reviews/sync";
import { reviewCache } from "../../src/bundled/reviews/storage";
import { useKeyboardFocusVisibility } from "../../src/shared/design-system/useKeyboardFocusVisibility";

// Only GitHub is a fixture boundary; sync, IndexedDB and rendering are production owners.
const reviews = createReviewSync(async (query, variables, signal) => {
  const response = await fetch("/reviews-fixture", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
    signal: signal ?? null,
  });
  if (!response.ok) throw new Error("GitHub fixture is offline");
  return response.json();
}, reviewCache());
void reviews.sync();
window.addEventListener("pagehide", () => reviews.dispose(), { once: true });
function Fixture() {
  useKeyboardFocusVisibility();
  return (
    <div style={{ height: "100dvh" }}>
      <ReviewsPage reviews={reviews} />
    </div>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Fixture root unavailable");
createRoot(root).render(<Fixture />);
