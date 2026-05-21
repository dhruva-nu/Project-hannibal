import type { ReactNode } from "react";

export const ILLUSTRATIONS: Record<string, ReactNode> = {
  "course.001": (
    <svg viewBox="0 0 240 130" preserveAspectRatio="none">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
        <rect x="20" y="50" width="50" height="30" rx="6" fill="var(--paper)" />
        <rect x="100" y="30" width="50" height="30" rx="6" fill="var(--paper)" />
        <rect x="100" y="80" width="50" height="30" rx="6" fill="var(--paper)" />
        <rect x="180" y="50" width="40" height="30" rx="6" fill="var(--paper)" />
        <path d="M70 65 L 100 45" strokeDasharray="3 3" />
        <path d="M70 65 L 100 95" strokeDasharray="3 3" />
        <path d="M150 45 L 180 65" strokeDasharray="3 3" />
      </g>
      <g fontFamily="JetBrains Mono" fontSize="8" fill="var(--ink-soft)">
        <text x="32" y="70">user</text>
        <text x="110" y="50">api</text>
        <text x="108" y="100">redis</text>
        <text x="186" y="70">sms</text>
      </g>
    </svg>
  ),
  "course.002": (
    <svg viewBox="0 0 240 130" preserveAspectRatio="none">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
        <circle cx="40" cy="65" r="20" fill="var(--paper)" />
        <circle cx="200" cy="65" r="20" fill="var(--paper)" />
        <rect x="100" y="45" width="50" height="40" rx="6" fill="var(--paper)" />
        <path d="M60 55 Q 90 35 100 55" strokeDasharray="3 3" />
        <path d="M60 75 Q 90 95 100 75" strokeDasharray="3 3" />
        <path d="M150 55 Q 175 45 180 55" strokeDasharray="3 3" />
        <path d="M150 75 Q 175 85 180 75" strokeDasharray="3 3" />
      </g>
      <g fontFamily="JetBrains Mono" fontSize="8" fill="var(--ink-soft)">
        <text x="30" y="68">you</text>
        <text x="113" y="68">app</text>
        <text x="186" y="68">google</text>
      </g>
    </svg>
  ),
  "course.003": (
    <svg viewBox="0 0 240 130" preserveAspectRatio="none">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
        <rect x="20" y="55" width="40" height="20" rx="4" fill="var(--paper)" />
        <rect x="20" y="80" width="40" height="20" rx="4" fill="var(--paper)" />
        <rect x="20" y="30" width="40" height="20" rx="4" fill="var(--paper)" />
        <rect x="100" y="50" width="60" height="30" rx="6" fill="var(--paper)" />
        <rect x="190" y="50" width="40" height="30" rx="6" fill="var(--paper)" />
        <path d="M60 40 L 100 60" strokeDasharray="3 3" />
        <path d="M60 65 L 100 65" strokeDasharray="3 3" />
        <path d="M60 90 L 100 70" strokeDasharray="3 3" stroke="var(--accent-2)" />
        <path d="M160 65 L 190 65" strokeDasharray="3 3" />
        <text x="68" y="98" fontFamily="Caveat" fontSize="12" fill="var(--accent-2)">429!</text>
      </g>
      <g fontFamily="JetBrains Mono" fontSize="8" fill="var(--ink-soft)">
        <text x="115" y="68">limiter</text>
        <text x="200" y="68">api</text>
      </g>
    </svg>
  ),
  "course.004": (
    <svg viewBox="0 0 240 130" preserveAspectRatio="none">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
        <rect x="20" y="50" width="40" height="30" rx="4" fill="var(--paper)" />
        <rect x="80" y="40" width="80" height="50" rx="4" fill="var(--paper)" />
        <line x1="100" y1="40" x2="100" y2="90" strokeDasharray="2 2" />
        <line x1="120" y1="40" x2="120" y2="90" strokeDasharray="2 2" />
        <line x1="140" y1="40" x2="140" y2="90" strokeDasharray="2 2" />
        <rect x="180" y="35" width="40" height="22" rx="4" fill="var(--paper)" />
        <rect x="180" y="73" width="40" height="22" rx="4" fill="var(--paper)" />
        <path d="M60 65 L 80 65" strokeDasharray="3 3" />
        <path d="M160 50 L 180 46" strokeDasharray="3 3" />
        <path d="M160 80 L 180 84" strokeDasharray="3 3" />
      </g>
      <g fontFamily="JetBrains Mono" fontSize="8" fill="var(--ink-soft)">
        <text x="28" y="68">job</text>
        <text x="106" y="68">queue</text>
        <text x="186" y="50">w1</text>
        <text x="186" y="89">w2</text>
      </g>
    </svg>
  ),
  "course.005": (
    <svg viewBox="0 0 240 130" preserveAspectRatio="none">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
        <rect x="20" y="50" width="50" height="30" rx="6" fill="var(--paper)" />
        <rect x="170" y="50" width="50" height="30" rx="6" fill="var(--paper)" />
        <rect x="100" y="20" width="40" height="20" rx="4" fill="var(--paper)" strokeDasharray="3 3" />
        <rect x="100" y="55" width="40" height="20" rx="4" fill="var(--paper)" />
        <rect x="100" y="90" width="40" height="20" rx="4" fill="var(--paper)" strokeDasharray="3 3" />
        <path d="M70 65 L 100 30" strokeDasharray="3 3" />
        <path d="M70 65 L 100 65" />
        <path d="M70 65 L 100 100" strokeDasharray="3 3" />
        <path d="M140 65 L 170 65" />
      </g>
      <g fontFamily="JetBrains Mono" fontSize="8" fill="var(--ink-soft)">
        <text x="32" y="68">us</text>
        <text x="180" y="68">you</text>
        <text x="108" y="68">retry</text>
      </g>
    </svg>
  ),
  "picked.001": (
    <svg viewBox="0 0 240 130" preserveAspectRatio="none">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
        <rect x="60" y="40" width="50" height="50" rx="6" fill="var(--paper)" />
        <rect x="140" y="40" width="50" height="50" rx="6" fill="var(--paper)" />
        <path d="M110 65 L 140 65" strokeDasharray="3 3" />
        <text x="78" y="68" fontFamily="Caveat" fontSize="14" fill="var(--accent-2)">2FA</text>
        <text x="158" y="68" fontFamily="Caveat" fontSize="14" fill="var(--accent-3)">TOTP</text>
      </g>
    </svg>
  ),
  "picked.002": (
    <svg viewBox="0 0 240 130" preserveAspectRatio="none">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
        <circle cx="60" cy="65" r="20" fill="var(--paper)" />
        <circle cx="120" cy="40" r="14" fill="var(--paper)" />
        <circle cx="120" cy="90" r="14" fill="var(--paper)" />
        <circle cx="180" cy="65" r="20" fill="var(--paper)" />
        <path d="M80 60 L 108 45" strokeDasharray="3 3" />
        <path d="M80 75 L 108 88" strokeDasharray="3 3" />
        <path d="M132 45 L 162 60" strokeDasharray="3 3" />
        <path d="M132 88 L 162 75" strokeDasharray="3 3" />
      </g>
    </svg>
  ),
  "picked.003": (
    <svg viewBox="0 0 240 130" preserveAspectRatio="none">
      <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
        <rect x="20" y="50" width="60" height="30" rx="4" fill="var(--paper)" />
        <rect x="100" y="50" width="60" height="30" rx="4" fill="var(--paper)" />
        <rect x="180" y="50" width="40" height="30" rx="4" fill="var(--paper)" />
        <path d="M80 65 L 100 65" />
        <path d="M160 65 L 180 65" />
        <path d="M50 50 Q 50 30, 130 30 Q 200 30, 200 50" strokeDasharray="3 3" stroke="var(--accent-2)" />
        <text x="116" y="26" fontFamily="Caveat" fontSize="12" fill="var(--accent-2)">cache</text>
      </g>
    </svg>
  ),
};
