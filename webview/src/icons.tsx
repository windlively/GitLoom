import type { CSSProperties } from 'react';
import '@vscode/codicons/dist/codicon.css';

interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}
function icon(name: string) {
  return function Codicon({ size = 16, className = '' }: IconProps) {
    return (
      <span
        aria-hidden="true"
        className={`codicon codicon-${name} ${className}`}
        style={{ '--icon-size': `${size}px` } as CSSProperties}
      />
    );
  };
}
export const ArrowDown = icon('arrow-down');
export const ArrowDownToLine = icon('cloud-download');
export const ArrowLeftRight = icon('split-horizontal');
export const ArrowUp = icon('arrow-up');
export const ArrowUpFromLine = icon('cloud-upload');
export const BookOpen = icon('book');
export const Box = icon('remote');
export const Check = icon('check');
export const CheckCheck = icon('check-all');
export const ChevronDown = icon('chevron-down');
export const ChevronLeft = icon('chevron-left');
export const ChevronRight = icon('chevron-right');
export const Circle = icon('circle-outline');
export const CircleCheck = icon('pass');
export const Clock3 = icon('history');
export const Code2 = icon('code');
export const Command = icon('keyboard');
export const Ellipsis = icon('ellipsis');
export const ExternalLink = icon('link-external');
export const File = icon('file');
export const FileCode2 = icon('file-code');
export const FileJson = icon('json');
export const FolderClosed = icon('folder');
export const FolderGit2 = icon('repo');
export const GitBranch = icon('git-branch');
export const GitCommitHorizontal = icon('git-commit');
export const GitCompareArrows = icon('diff');
export const GitFork = icon('repo-forked');
export const GitMerge = icon('git-merge');
export const History = icon('history');
export const Info = icon('info');
export const Layers = icon('archive');
export const ListChecks = icon('source-control');
export const LoaderCircle = icon('loading');
export const Maximize2 = icon('screen-full');
export const Package = icon('package');
export const Plus = icon('add');
export const RefreshCw = icon('refresh');
export const Search = icon('search');
export const Settings2 = icon('settings-gear');
export const ShieldCheck = icon('verified');
export const SlidersHorizontal = icon('filter');
export const Sparkles = icon('sparkle');
export const Terminal = icon('terminal');
export const Trash2 = icon('trash');
export const Undo2 = icon('discard');
export const X = icon('close');
