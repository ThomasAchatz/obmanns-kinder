const paths = {
  home: "M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z",
  play: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 3.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z",
  write: "M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3zM14 8l3 3",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9c0-3.9 3.1-6 7-6s7 2.1 7 6",
  back: "M15 5l-7 7 7 7",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  thumbUp: "M7 11v9H4v-9zm0 0 4-7c1.4 0 2.2 1 2 2.3L12.6 10H18a2 2 0 0 1 2 2.3l-1.1 6A2 2 0 0 1 17 20H7",
  thumbDown: "M7 13V4H4v9zm0 0 4 7c1.4 0 2.2-1 2-2.3l-.4-3.7H18a2 2 0 0 0 2-2.3l-1.1-6A2 2 0 0 0 17 4H7",
  flag: "M5 21V4m0 0h11l-2 4 2 4H5",
  image: "M4 5h16v14H4zM4 15l4.5-4.5 4 4L15 12l5 5M15.5 9.5a1 1 0 1 0 0-.1",
  face: "M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm6 3.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4zM7 18c.8-2.4 2.7-3.6 5-3.6s4.2 1.2 5 3.6",
  trash: "M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  close: "M6 6l12 12M18 6 6 18",
  music: "M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  playTri: "M8 5.5v13l10.5-6.5z",
  pause: "M8 5v14M16 5v14",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 2-4-4",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 22, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
