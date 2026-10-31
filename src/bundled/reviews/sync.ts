import { GhUnavailable, type GitHubCli } from "../github/gh";
import {
  ACCOUNT_QUERY,
  discoverReviews,
  GitHubAccountChanged,
  type GitHubAccount,
  type ReviewSnapshot,
} from "./github";
import type { ReviewCache } from "./storage";

export type ReviewSyncState = {
  account: GitHubAccount | null;
  snapshot: ReviewSnapshot | null;
  syncing: boolean;
  error: string | null;
};

/** One plugin lifetime owns discovery, regardless of whether its page is open. */
export function createReviewSync(
  gh: GitHubCli | undefined,
  cache: ReviewCache,
) {
  let state: ReviewSyncState = {
    account: null,
    snapshot: null,
    syncing: false,
    error: null,
  };
  const listeners = new Set<() => void>();
  const controller = new AbortController();
  let pending: Promise<void> | undefined;
  const publish = (patch: Partial<ReviewSyncState>) => {
    if (controller.signal.aborted) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const sync = (): Promise<void> => {
    if (controller.signal.aborted) return Promise.resolve();
    if (pending) return pending;
    pending = Promise.resolve().then(async () => {
      try {
        if (!gh)
          throw new GhUnavailable(
            "GitHub review sync requires Buzz desktop and GitHub CLI. Sign in with gh auth login, then refresh.",
          );
        const { viewer: account } = await gh<{ viewer: GitHubAccount }>(
          ACCOUNT_QUERY,
          {},
          controller.signal,
        );
        controller.signal.throwIfAborted();
        if (!account?.id || !account.login)
          throw new Error("GitHub did not identify the signed-in account.");
        if (account.id !== state.account?.id) {
          publish({ account, snapshot: null });
        } else publish({ account });
        if (!state.snapshot) {
          const saved = await cache.load(account.id);
          controller.signal.throwIfAborted();
          publish({ snapshot: saved ?? null });
        }
        const requests = await discoverReviews(gh, account, controller.signal);
        controller.signal.throwIfAborted();
        const snapshot = {
          account,
          requests,
          syncedAt: new Date().toISOString(),
        };
        await cache.save(snapshot, controller.signal);
        publish({ snapshot });
      } catch (error) {
        if (error instanceof GitHubAccountChanged)
          publish({ account: null, snapshot: null });
        publish({
          error:
            error instanceof GhUnavailable
              ? "GitHub is unavailable. Use Buzz desktop with GitHub CLI signed in (gh auth login), then refresh."
              : error instanceof Error
                ? error.message
                : String(error),
        });
      } finally {
        pending = undefined;
        publish({ syncing: false });
      }
    });
    publish({ syncing: true, error: null });
    return pending;
  };
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sync,
    dispose() {
      controller.abort();
      listeners.clear();
    },
  };
}
export type ReviewSync = ReturnType<typeof createReviewSync>;
