import type { CSSProperties } from 'react';
export type IconName =
  | 'home'
  | 'book'
  | 'plus'
  | 'search'
  | 'close'
  | 'arrow'
  | 'chevron'
  | 'edit'
  | 'trash'
  | 'file'
  | 'upload'
  | 'chat'
  | 'check'
  | 'folder'
  | 'spark'
  | 'settings'
  | 'info'
  | 'bolt'
  | 'reset';
const paths: Record<IconName, React.ReactNode> = {
  bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7Z" />,
  reset: <path d="M3 10a9 9 0 1 1 1 8M3 4v6h6" />,
  settings: (
    <>
      <path d="m10 3-1 3-3 1-3 3v4l3 3 3 1 1 3h4l1-3 3-1 3-3v-4l-3-3-3-1-1-3Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  home: (
    <>
      <path d="m3 10 9-7 9 7" />
      <path d="M5 9v11h5v-7h4v7h5V9" />
    </>
  ),
  book: (
    <>
      <path d="M12 5v16M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Z" />
      <path d="m6 8 3 1m6 0 3-1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  arrow: <path d="M12 19V5m-6 6 6-6 6 6" />,
  chevron: <path d="m14 6-6 6 6 6" />,
  edit: (
    <>
      <path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14Z" />
      <path d="M13 20h8" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H5v18h14V8Z" />
      <path d="M14 3v6h5M8 13h8m-8 4h6" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" />
    </>
  ),
  chat: <path d="M4 4h16v13H9l-5 4Z" />,
  check: <path d="m5 12 4 4L19 6" />,
  folder: <path d="M3 6h7l2 3h9v11H3Zm0 0V4h7l2 2h8v3" />,
  spark: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v1" />
    </>
  ),
};
export function Icon({
  name,
  size = 20,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
