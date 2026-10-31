import { useSyncExternalStore } from "react";
import {
  ArrowClockwiseIcon,
  GitPullRequestIcon,
} from "../../shared/design-system/icons";
import { EmptyState } from "../../shared/design-system/ui/EmptyState";
import { FullPageSurface } from "../../shared/design-system/ui/FullPageSurface";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { LoadingRegion } from "../../shared/design-system/ui/LoadingRegion";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import {
  PanelHeader,
  PanelHeaderLabel,
} from "../../shared/design-system/ui/PanelHeader";
import type { ReviewSync } from "./sync";

export function ReviewsPage({ reviews }: { reviews: ReviewSync }) {
  const { account, snapshot, syncing, error } = useSyncExternalStore(
    reviews.subscribe,
    reviews.snapshot,
  );
  return (
    <FullPageSurface aria-label="Reviews">
      <div className="flex h-full min-h-0 flex-col">
        <PanelHeader
          title={<PanelHeaderLabel title="Reviews" />}
          actions={
            <IconButton
              aria-label="Refresh reviews"
              title="Refresh reviews"
              icon={<ArrowClockwiseIcon />}
              onClick={() => void reviews.sync()}
            />
          }
        />
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <p className="text-body-sm text-secondary">
            {account
              ? `Review requests for @${account.login}`
              : "GitHub review requests"}
          </p>
          <p className="text-caption text-metadata">
            {snapshot
              ? `Last synced ${new Date(snapshot.syncedAt).toLocaleString()}. `
              : ""}
            Syncs about every five minutes while Reviews is enabled and Buzz is
            open.
          </p>
          <LoadingRegion
            pending={syncing}
            label="Syncing reviews…"
            feedback={
              error ? (
                <p role="alert" className="text-body-sm text-secondary">
                  {error}
                  {snapshot ? " Showing saved reviews." : ""}
                </p>
              ) : undefined
            }
          >
            {snapshot ? (
              snapshot.requests.length ? (
                <ul
                  aria-label="Outstanding review requests"
                  className="flex flex-col gap-1"
                >
                  {snapshot.requests.map((pr) => (
                    <li key={pr.id}>
                      <NavigationItem
                        nativeButton={false}
                        role="link"
                        render={
                          <a href={pr.url} target="_blank" rel="noreferrer" />
                        }
                        multiline
                        icon={<GitPullRequestIcon aria-hidden="true" />}
                        label={
                          <span className="flex min-w-0 flex-col gap-1">
                            <span className="text-body text-standard break-words">
                              {pr.title}
                            </span>
                            <span className="text-caption text-metadata break-words">
                              {pr.repository.nameWithOwner} #{pr.number}
                              {pr.author ? ` · ${pr.author.login}` : ""}
                              {pr.isDraft ? " · Draft" : ""}
                            </span>
                          </span>
                        }
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={<GitPullRequestIcon />}
                  title="No outstanding reviews"
                  description="GitHub has no open pull requests requesting your review, directly or through your teams."
                />
              )
            ) : (
              !syncing && (
                <EmptyState
                  icon={<GitPullRequestIcon />}
                  title="Connect GitHub"
                  description="Use Buzz desktop with GitHub CLI signed in, then refresh to load your review requests."
                />
              )
            )}
          </LoadingRegion>
        </div>
      </div>
    </FullPageSurface>
  );
}
