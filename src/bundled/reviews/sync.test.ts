import { afterEach, expect, it, vi } from "vitest";
import type { GitHubCli } from "../github/gh";
import {
  ACCOUNT_QUERY,
  type GitHubAccount,
  type ReviewRequest,
  type ReviewSnapshot,
} from "./github";
import { createReviewSync } from "./sync";

const account = { id: "user-a", login: "alex" };
const request = (number: number): ReviewRequest => ({
  id: `pr-${number}`,
  number,
  title: `Change ${number}`,
  url: `https://github.com/sample/project/pull/${number}`,
  repository: { nameWithOwner: "sample/project" },
  updatedAt: "2026-10-31T12:00:00Z",
  isDraft: false,
  author: { login: "sam" },
});
function page(nodes: ReviewRequest[], options = {}) {
  return {
    viewer: account,
    search: {
      nodes,
      issueCount: nodes.length,
      pageInfo: { hasNextPage: false, endCursor: null },
      ...options,
    },
  };
}
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const rows = new Map<string, ReviewSnapshot>();
  let viewer: GitHubAccount = account;
  let search = async (_variables: Record<string, unknown>): Promise<unknown> =>
    page([request(1)]);
  const gh: GitHubCli = async <T>(
    query: string,
    variables: Record<string, unknown>,
  ) => {
    return (
      query === ACCOUNT_QUERY ? { viewer } : await search(variables)
    ) as T;
  };
  const cache = {
    load: vi.fn(async (id: string) => rows.get(id)),
    save: vi.fn(async (snapshot: ReviewSnapshot) => {
      rows.set(snapshot.account.id, structuredClone(snapshot));
    }),
  };
  const sync = createReviewSync(gh, cache);
  disposers.push(sync.dispose);
  return {
    sync,
    cache,
    rows,
    gh,
    search: (read: typeof search) => {
      search = read;
    },
    viewer: (next: GitHubAccount) => {
      viewer = next;
    },
  };
}
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

// The sync owner is new: existing gh tests cover transport, not complete-queue reconciliation.
it("coalesces refreshes, commits all pages, and reconciles changed and removed requests", async () => {
  const f = setup();
  const started = gate<void>();
  const release = gate<unknown>();
  const queries: unknown[] = [];
  f.search(async (variables) => {
    queries.push(variables.query);
    if (!variables.after) {
      started.resolve();
      return release.promise;
    }
    return page([request(2)], { issueCount: 2 });
  });
  const pending = f.sync.sync();
  try {
    await started.promise;
    expect(f.sync.sync()).toBe(pending);
    expect(f.sync.snapshot()).toMatchObject({ syncing: true, snapshot: null });
    expect(f.cache.save).not.toHaveBeenCalled();
  } finally {
    release.resolve(
      page([request(1)], {
        issueCount: 2,
        pageInfo: { hasNextPage: true, endCursor: "next" },
      }),
    );
    await pending;
  }
  expect(f.sync.snapshot().snapshot?.requests.map((pr) => pr.number)).toEqual([
    1, 2,
  ]);
  expect(f.cache.save).toHaveBeenCalledOnce();
  // Independent GitHub search contract: this includes direct and team requests.
  expect(queries).toEqual([
    "is:pr is:open review-requested:alex sort:updated-desc",
    "is:pr is:open review-requested:alex sort:updated-desc",
  ]);
  f.search(async () =>
    page([{ ...request(2), title: "Updated title", isDraft: true }]),
  );
  await f.sync.sync();
  expect(f.rows.get(account.id)?.requests).toEqual([
    { ...request(2), title: "Updated title", isDraft: true },
  ]);
  f.search(async () => page([]));
  await f.sync.sync();
  expect(f.sync.snapshot().snapshot?.requests).toEqual([]);
});

it.each([
  [
    "later-page failure",
    async () => {
      throw new Error("Offline");
    },
  ],
  ["search cap", async () => page([], { issueCount: 1000 })],
  ["inconsistent count", async () => page([], { issueCount: 2 })],
  [
    "invalid link",
    async () => page([{ ...request(2), url: "https://other.example/pull/2" }]),
  ],
  [
    "repeated cursor",
    async () =>
      page([request(2)], {
        issueCount: 2,
        pageInfo: { hasNextPage: true, endCursor: "next" },
      }),
  ],
])(
  "preserves saved rows on %s and recovers on refresh",
  async (_name, answer) => {
    const f = setup();
    await f.sync.sync();
    const previous = f.rows.get(account.id);
    f.cache.save.mockClear();
    f.search(async (variables) =>
      variables.after
        ? answer()
        : page([request(2)], {
            issueCount: 2,
            pageInfo: { hasNextPage: true, endCursor: "next" },
          }),
    );
    await f.sync.sync();
    expect(f.sync.snapshot()).toMatchObject({
      syncing: false,
      snapshot: previous,
      error: expect.any(String),
    });
    expect(f.cache.save).not.toHaveBeenCalled();
    f.search(async () => page([request(3)]));
    await f.sync.sync();
    expect(f.sync.snapshot()).toMatchObject({
      error: null,
      snapshot: { requests: [request(3)] },
    });
  },
);

it("never displays the previous account's queue after an observed account switch", async () => {
  const f = setup();
  await f.sync.sync();
  f.viewer({ id: "user-b", login: "blair" });
  f.search(async () => {
    throw new Error("Offline");
  });
  await f.sync.sync();
  expect(f.sync.snapshot()).toMatchObject({
    account: { id: "user-b" },
    snapshot: null,
    error: "Offline",
  });
  expect(f.rows.get(account.id)?.requests).toEqual([request(1)]);
  // A switch while pagination is running must not save the other user's answer.
  f.viewer(account);
  f.search(async () => ({
    ...page([request(2)]),
    viewer: { id: "user-b", login: "blair" },
  }));
  await f.sync.sync();
  expect(f.sync.snapshot()).toMatchObject({
    account: null,
    snapshot: null,
    error: expect.stringContaining("account changed"),
  });
  expect(f.rows.get(account.id)?.requests).toEqual([request(1)]);
});

it("retains the prior snapshot on a storage failure, then retries successfully", async () => {
  const f = setup();
  await f.sync.sync();
  f.search(async () => page([request(2)]));
  f.cache.save.mockRejectedValueOnce(new Error("Storage full"));
  await f.sync.sync();
  expect(f.sync.snapshot()).toMatchObject({
    snapshot: { requests: [request(1)] },
    error: "Storage full",
  });
  await f.sync.sync();
  expect(f.sync.snapshot()).toMatchObject({
    snapshot: { requests: [request(2)] },
    error: null,
  });
});

it("does not persist or publish late work after plugin disposal", async () => {
  const f = setup();
  const started = gate<void>();
  const release = gate<unknown>();
  f.search(async () => {
    started.resolve();
    return release.promise;
  });
  const listener = vi.fn();
  f.sync.subscribe(listener);
  const pending = f.sync.sync();
  try {
    await started.promise;
    f.sync.dispose();
    listener.mockClear();
  } finally {
    release.resolve(page([request(1)]));
    await pending;
  }
  expect(f.cache.save).not.toHaveBeenCalled();
  expect(listener).not.toHaveBeenCalled();
  expect(f.sync.snapshot().snapshot).toBeNull();
});

it("shows desktop setup guidance when processes are unavailable and allows retry", async () => {
  const f = setup();
  const sync = createReviewSync(undefined, f.cache);
  disposers.push(sync.dispose);
  await sync.sync();
  expect(sync.snapshot()).toMatchObject({
    syncing: false,
    error: expect.stringContaining("gh auth login"),
  });
  await sync.sync();
  expect(sync.snapshot().syncing).toBe(false);
  expect(f.cache.load).not.toHaveBeenCalled();
});
