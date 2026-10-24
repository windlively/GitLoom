import type { Branch } from '../../src/shared/types';
import { t } from './i18n';

// IDEA-style markers on local branches, counted against the upstream from the last
// fetch: ↑ commits the upstream does not have yet, ↓ commits this branch does not have.
export function BranchSync({ branch }: { branch: Branch }) {
  if (branch.remote || (!branch.ahead && !branch.behind)) return null;
  return (
    <span className="branch-sync">
      {branch.ahead > 0 && (
        <span className="branch-sync-ahead" title={t('{0} commits to push', branch.ahead)}>
          ↑{branch.ahead}
        </span>
      )}
      {branch.behind > 0 && (
        <span className="branch-sync-behind" title={t('{0} commits to pull', branch.behind)}>
          ↓{branch.behind}
        </span>
      )}
    </span>
  );
}
