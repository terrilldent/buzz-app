import type { GitHubCli } from "../github/gh";

export type GitHubAccount = { id: string; login: string };
export type ReviewRequest = {
  id: string;
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  isDraft: boolean;
  repository: { nameWithOwner: string };
  author: { login: string } | null;
};
export type ReviewSnapshot = {
  account: GitHubAccount;
  requests: ReviewRequest[];
  syncedAt: string;
};

export const ACCOUNT_QUERY = "query { viewer { id login } }";
const REQUESTS_QUERY = `query($query: String!, $after: String) {
  viewer { id login }
  search(query: $query, type: ISSUE, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      id number title url updatedAt isDraft
      repository { nameWithOwner }
      author { login }
    } }
  }
}`;

export class GitHubAccountChanged extends Error {}

/** Only a complete search may replace the queue, including removing old requests. */
export async function discoverReviews(
  gh: GitHubCli,
  account: GitHubAccount,
  signal: AbortSignal,
): Promise<ReviewRequest[]> {
  const requests = new Map<string, ReviewRequest>();
  const cursors = new Set<string>();
  let after: string | null = null;
  for (;;) {
    const result: {
      viewer: GitHubAccount;
      search: {
        issueCount: number;
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: ReviewRequest[];
      };
    } = await gh(
      REQUESTS_QUERY,
      {
        // Includes direct requests and requests to a team the viewer belongs to.
        query: `is:pr is:open review-requested:${account.login} sort:updated-desc`,
        after,
      },
      signal,
    );
    if (result.viewer.id !== account.id)
      throw new GitHubAccountChanged(
        "GitHub account changed. Refresh to load its reviews.",
      );
    const { issueCount, nodes, pageInfo } = result.search;
    // GitHub search only exposes the first 1,000 results. Be conservative at the cap.
    if (
      !Number.isSafeInteger(issueCount) ||
      issueCount < 0 ||
      issueCount >= 1000
    )
      throw new Error(
        "GitHub search is incomplete or reached its 1,000-result limit. Saved reviews were preserved.",
      );
    if (!Array.isArray(nodes))
      throw new Error("GitHub returned an incomplete review list.");
    for (const pr of nodes) {
      if (
        !pr ||
        typeof pr.id !== "string" ||
        !pr.id ||
        !Number.isSafeInteger(pr.number) ||
        pr.number <= 0 ||
        typeof pr.title !== "string" ||
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(
          pr.repository?.nameWithOwner,
        ) ||
        pr.url !==
          `https://github.com/${pr.repository.nameWithOwner}/pull/${pr.number}` ||
        typeof pr.updatedAt !== "string" ||
        !Number.isFinite(Date.parse(pr.updatedAt)) ||
        typeof pr.isDraft !== "boolean" ||
        (pr.author !== null && typeof pr.author?.login !== "string")
      )
        throw new Error("GitHub returned an invalid review request.");
      requests.set(pr.id, pr);
    }
    if (!pageInfo.hasNextPage) {
      if (requests.size !== issueCount)
        throw new Error(
          "GitHub's review list changed during sync. Refresh to try again; saved reviews were preserved.",
        );
      return [...requests.values()].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
    }
    const cursor = pageInfo.endCursor;
    if (!cursor || cursors.has(cursor) || cursors.size >= 10)
      throw new Error("GitHub returned an incomplete review list.");
    cursors.add(cursor);
    after = cursor;
  }
}
