import type { SVGProps } from 'react';

/** Every glyph is 24x24 viewBox, stroke="currentColor" (DESIGN_LANGUAGE §3 copy glyph). */
export type IconName =
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-up'
  | 'copy'
  | 'link'
  | 'check'
  | 'first'
  | 'prev'
  | 'next'
  | 'last'
  | 'close'
  | 'expand'
  | 'collapse'
  | 'external'
  | 'trash'
  | 'warning'
  | 'retry'
  | 'search'
  | 'plus'
  | 'minus'
  | 'more'
  | 'edit'
  | 'info'
  | 'menu'
  | 'sidebar'
  | 'logout'
  | 'user'
  | 'settings'
  | 'folder'
  | 'book'
  | 'home'
  | 'chart'
  | 'list'
  | 'flask'
  | 'sparkles'
  | 'review'
  | 'database'
  | 'shield'
  | 'archive'
  | 'play'
  | 'stop'
  | 'clock'
  | 'eye'
  | 'eye-off'
  | 'grid'
  | 'lock'
  | 'upload'
  | 'download'
  | 'swap';

const PATHS: Record<IconName, string> = {
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-up': 'M6 15l6-6 6 6',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  check: 'M5 12l5 5L20 7',
  first: 'M18 6l-6 6 6 6M8 6v12',
  prev: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  last: 'M6 6l6 6-6 6M16 6v12',
  close: 'M6 6l12 12M18 6L6 18',
  expand: 'M4 10V4h6M20 14v6h-6M4 4l6 6M20 20l-6-6',
  collapse: 'M10 4v6H4M14 20v-6h6M10 10L4 4M14 14l6 6',
  external: 'M14 4h6v6M20 4l-9 9M19 14v6H5V6h6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  warning: 'M12 3L2 21h20L12 3zM12 10v5M12 18v.5',
  retry: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  edit: 'M4 20h4l10-10-4-4L4 16v4zM13 7l4 4',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 11v5M12 8v.5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  sidebar: 'M4 5h16v14H4zM9 5v14',
  logout: 'M10 5H5v14h5M14 8l4 4-4 4M18 12H9',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .3-1.5-1.5.3-2-3-1-1 2h-2l-1-2-3 1 .3 2L6.6 8.3l-2-.3-1 3 2 1v2l-2 1 1 3 2-.3 1.5 1.5-.3 2 3 1 1-2h2l1 2 3-1-.3-2 1.5-1.5 2 .3 1-3-2-1z',
  folder: 'M3 6h6l2 2h10v11H3z',
  book: 'M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z',
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  flask: 'M9 3h6M10 3v6l-6 10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2l-6-10V3',
  sparkles: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM5 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
  review: 'M4 4h16v12H8l-4 4zM8 9h8M8 12h5',
  database:
    'M12 3c5 0 8 1.3 8 3s-3 3-8 3-8-1.3-8-3 3-3 8-3zM4 6v12c0 1.7 3 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3 3 8 3s8-1.3 8-3',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  archive: 'M3 5h18v4H3zM5 9v11h14V9M10 13h4',
  play: 'M7 5v14l12-7z',
  stop: 'M6 6h12v12H6z',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'eye-off':
    'M3 3l18 18M10 6a10 10 0 0 1 12 6 13 13 0 0 1-3 4M6 8a13 13 0 0 0-4 4s4 7 10 7a9 9 0 0 0 4-1M10 10a3 3 0 0 0 4 4',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
  upload: 'M12 16V4M6 10l6-6 6 6M4 20h16',
  download: 'M12 4v12M6 10l6 6 6-6M4 20h16',
  swap: 'M4 7h14M14 3l4 4-4 4M20 17H6M10 13l-4 4 4 4',
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: 12 | 14 | 16 | 20;
  /** Decorative by default; pass a title for standalone meaning. */
  title?: string;
}

export function Icon({ name, size = 14, title, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      data-icon={name}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
