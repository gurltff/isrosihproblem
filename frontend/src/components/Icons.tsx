import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 20, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (p: P) => (
  <Base {...p}>
    <rect x="3" y="3" width="7.5" height="9" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="5" rx="1.5" />
    <rect x="13.5" y="11" width="7.5" height="10" rx="1.5" />
    <rect x="3" y="15" width="7.5" height="6" rx="1.5" />
  </Base>
);
export const IconDetector = (p: P) => (
  <Base {...p}>
    <path d="M4 19h16" />
    <path d="M6 16V9M10 16V5M14 16v-5M18 16V7" />
    <circle cx="18" cy="4" r="1.6" />
  </Base>
);
export const IconDrift = (p: P) => (
  <Base {...p}>
    <path d="M3 18c4 0 6-2 8-6s4-7 10-7" />
    <path d="M3 21h18" strokeDasharray="2 3" />
    <circle cx="11" cy="12" r="1.6" />
  </Base>
);
export const IconHeatmap = (p: P) => (
  <Base {...p}>
    <rect x="3" y="3" width="5" height="5" rx="1" />
    <rect x="9.5" y="3" width="5" height="5" rx="1" />
    <rect x="16" y="3" width="5" height="5" rx="1" fill="currentColor" />
    <rect x="3" y="9.5" width="5" height="5" rx="1" />
    <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" />
    <rect x="16" y="9.5" width="5" height="5" rx="1" />
    <rect x="3" y="16" width="5" height="5" rx="1" />
    <rect x="9.5" y="16" width="5" height="5" rx="1" />
    <rect x="16" y="16" width="5" height="5" rx="1" />
  </Base>
);
export const IconChamber = (p: P) => (
  <Base {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8" cy="9" r="1.3" />
    <circle cx="12" cy="9" r="1.3" />
    <circle cx="16" cy="9" r="1.3" />
    <circle cx="8" cy="15" r="1.3" />
    <circle cx="12" cy="15" r="1.3" />
    <circle cx="16" cy="15" r="1.3" />
  </Base>
);
export const IconCamera = (p: P) => (
  <Base {...p}>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </Base>
);
export const IconUpload = (p: P) => (
  <Base {...p}>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
  </Base>
);
export const IconReport = (p: P) => (
  <Base {...p}>
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M15 3v4h4M9 12h7M9 16h7M9 8h3" />
  </Base>
);
export const IconMore = (p: P) => (
  <Base {...p}>
    <circle cx="5" cy="12" r="1.4" />
    <circle cx="12" cy="12" r="1.4" />
    <circle cx="19" cy="12" r="1.4" />
  </Base>
);
export const IconArrow = (p: P) => (
  <Base {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Base>
);
export const IconBack = (p: P) => (
  <Base {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Base>
);
export const IconHand = (p: P) => (
  <Base {...p}>
    <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v7M14 10.5V5.5a1.5 1.5 0 0 1 3 0V13" />
    <path d="M17 11.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.4L3.6 14.5a1.5 1.5 0 0 1 2.5-1.6L8 15" />
  </Base>
);
export const IconSwitch = (p: P) => (
  <Base {...p}>
    <path d="M4 8h13l-3-3M20 16H7l3 3" />
  </Base>
);
export const IconPrint = (p: P) => (
  <Base {...p}>
    <path d="M7 9V3h10v6" />
    <rect x="3" y="9" width="18" height="8" rx="2" />
    <path d="M7 14h10v7H7z" />
  </Base>
);

export const IconFist = (p: P) => (
  <Base {...p}>
    <path d="M6 11a2 2 0 0 1 2-2h8.5a2 2 0 0 1 2 2v4a6 6 0 0 1-6 6h-1a5.5 5.5 0 0 1-5.5-5.5z" />
    <path d="M9.5 9v2.5M12.5 9v2.5M15.5 9v2.5M6 14.5h5" />
  </Base>
);
export const IconPoint = (p: P) => (
  <Base {...p}>
    <path d="M10 12V4.5a1.5 1.5 0 0 1 3 0V12" />
    <path d="M13 11h3.5a2 2 0 0 1 2 2v2a6 6 0 0 1-6 6h-1a5.5 5.5 0 0 1-5.5-5.5V14a2 2 0 0 1 2-2h2" />
  </Base>
);
export const IconVictory = (p: P) => (
  <Base {...p}>
    <path d="M10 12 8 4.8a1.4 1.4 0 0 1 2.7-.8L12.5 10.5M12.5 10.5l1.8-6.4a1.4 1.4 0 0 1 2.7.8L15.5 12" />
    <path d="M15.5 11.5h1a2 2 0 0 1 2 2V15a6 6 0 0 1-6 6h-1a5.5 5.5 0 0 1-5.5-5.5V14a2 2 0 0 1 2-2h2" />
  </Base>
);
export const IconData = (p: P) => (
  <Base {...p}>
    <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
    <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
  </Base>
);
