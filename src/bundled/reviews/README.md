# Reviews

A private local list of outstanding GitHub review requests.

## Getting started

Enable **Reviews** in **Settings → Plugins → Manage plugins**, then open it in the
sidebar. New installations start disabled; existing plugin preferences are preserved.
Use Buzz desktop with GitHub CLI installed and signed in (`gh auth login`).
Reviews reuses Buzz's existing GitHub GraphQL client; credentials stay with `gh`.
Browser mode displays setup guidance and cannot run GitHub synchronization.

Open pull requests requesting your review, directly or through your teams, sync
when the plugin activates and about every five minutes while Buzz is open and
Reviews is enabled. **Refresh reviews** requests an immediate sync. Concurrent
refreshes share one operation. Click a row to open the PR on GitHub.

The latest complete queue and its sync timestamp are saved in IndexedDB, scoped
to the GitHub account rather than a Buzz community. Switching communities keeps
the same queue. Each refresh verifies the GitHub account before showing its saved
rows; changing CLI accounts loads that account's separate cache. A restart needs
GitHub to identify the account before cached rows can be displayed. Saved data is
local to this browser/WebView profile, with no relay or cross-device sync.

Successful syncs add new requests, update changed PRs, and remove requests no longer
returned by GitHub. Failed, partial, or capped searches preserve the previous
snapshot and show an error. GitHub search can lag recent changes. There is no
closed-app background service, review analysis, or review submission in this slice.
