export function getTerminalLabFaviconDataUri() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <defs>
        <radialGradient id="g" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stop-color="#ecfdf5" stop-opacity="1"/>
          <stop offset="45%" stop-color="#4ade80" stop-opacity="0.95"/>
          <stop offset="100%" stop-color="#052e16" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="#06141f"/>
      <circle cx="32" cy="32" r="20" fill="url(#g)"/>
      <ellipse cx="32" cy="32" rx="21" ry="11.5" fill="none" stroke="#86efac" stroke-width="2.2" stroke-dasharray="8 5 3 5"/>
      <ellipse cx="32" cy="32" rx="13" ry="22" fill="none" stroke="#67e8f9" stroke-width="1.8" stroke-dasharray="7 5 2 6" transform="rotate(26 32 32)"/>
      <circle cx="50" cy="30" r="2.8" fill="#f0fdf4" stroke="#10b981" stroke-width="1.2"/>
      <circle cx="42" cy="15" r="2.4" fill="#f0fdf4" stroke="#10b981" stroke-width="1.1"/>
      <circle cx="32" cy="32" r="8.5" fill="#0b2432" stroke="#22c55e" stroke-width="1.8"/>
      <path d="M26 28L31 32L26 36" fill="none" stroke="#f0fdf4" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
      <line x1="34" y1="36" x2="40" y2="36" stroke="#f0fdf4" stroke-width="2.6" stroke-linecap="round"/>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.trim())}`;
}

export default function TerminalLabLogo({ className = "", title = "TERMINAL LAB" }) {
  const classes = ["terminal-lab-logo", className].filter(Boolean).join(" ");
  return (
    <svg aria-label={title} className={classes} role="img" viewBox="0 0 220 220" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient cx="50%" cy="50%" id="terminalLabCoreGlow" r="55%">
          <stop offset="0%" stopColor="#ecfdf5" stopOpacity="0.98" />
          <stop offset="35%" stopColor="#6ee7b7" stopOpacity="0.9" />
          <stop offset="70%" stopColor="#16a34a" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#052e16" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="terminalLabOrbitStroke" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="#bbf7d0" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#34d399" stopOpacity="0.82" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id="terminalLabArcStroke" x1="10%" x2="90%" y1="10%" y2="90%">
          <stop offset="0%" stopColor="#f0fdf4" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#4ade80" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.45" />
        </linearGradient>
        <filter height="180%" id="terminalLabSoftGlow" width="180%" x="-40%" y="-40%">
          <feGaussianBlur result="blur" stdDeviation="5" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g className="terminal-lab-logo-backdrop">
        <circle className="terminal-lab-logo-glow" cx="110" cy="110" fill="url(#terminalLabCoreGlow)" r="74" />
        <circle className="terminal-lab-logo-halo" cx="110" cy="110" r="84" />
      </g>

      <g className="terminal-lab-logo-grid">
        <path d="M48 116C66 86 86 74 112 74C138 74 160 87 176 110" />
        <path d="M60 150C80 165 96 170 114 170C136 170 154 160 168 140" />
      </g>

      <g className="terminal-lab-logo-orbit-group terminal-lab-logo-orbit-group-a">
        <ellipse className="terminal-lab-logo-orbit" cx="110" cy="110" rx="74" ry="44" />
        <circle className="terminal-lab-logo-node terminal-lab-logo-node-a" cx="176" cy="104" r="6" />
        <circle className="terminal-lab-logo-node terminal-lab-logo-node-b" cx="48" cy="121" r="5" />
      </g>

      <g className="terminal-lab-logo-orbit-group terminal-lab-logo-orbit-group-b">
        <ellipse className="terminal-lab-logo-orbit is-secondary" cx="110" cy="110" rx="46" ry="78" transform="rotate(24 110 110)" />
        <circle className="terminal-lab-logo-node terminal-lab-logo-node-c" cx="146" cy="45" r="5" />
        <circle className="terminal-lab-logo-node terminal-lab-logo-node-d" cx="75" cy="176" r="6" />
      </g>

      <g className="terminal-lab-logo-core-group" filter="url(#terminalLabSoftGlow)">
        <circle className="terminal-lab-logo-core-shell" cx="110" cy="110" r="30" />
        <circle className="terminal-lab-logo-core" cx="110" cy="110" r="21" />
        <path className="terminal-lab-logo-terminal-mark" d="M96 103L107 112L96 121" />
        <line className="terminal-lab-logo-terminal-line" x1="112" x2="126" y1="121" y2="121" />
      </g>

      <g className="terminal-lab-logo-stars">
        <circle cx="72" cy="60" r="1.6" />
        <circle cx="158" cy="69" r="1.8" />
        <circle cx="154" cy="156" r="1.5" />
        <circle cx="64" cy="148" r="1.4" />
      </g>
    </svg>
  );
}
