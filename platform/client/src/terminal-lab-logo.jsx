export const COMMUNITY_BRAND_NAME = "KIKI OS TERMINAL-LAB";

export function getTerminalLabFaviconHref() {
  return "/community-logo.svg";
}

export default function TerminalLabLogo({ className = "", title = COMMUNITY_BRAND_NAME }) {
  return (
    <svg aria-label={title} className={`terminal-lab-logo kiki-os-symbol ${className}`.trim()} role="img" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <title>{title}</title>
      <rect width="64" height="64" rx="16" fill="#102b3f" />
      <path d="M19 16v32M43 16 25 32l18 16" fill="none" stroke="#71e5cb" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m43 27 5 5-5 5m1 7h7" fill="none" stroke="#eefcf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TerminalLabBrand({ className = "", logoPath = "" }) {
  return (
    <span aria-label={COMMUNITY_BRAND_NAME} className={`kiki-os-brand ${className}`.trim()} role="img">
      {logoPath ? <img alt="" className="kiki-os-brand-symbol" src={logoPath} /> : <span aria-hidden="true" className="kiki-os-brand-symbol"><TerminalLabLogo /></span>}
      <span aria-hidden="true" className="kiki-os-brand-copy">
        <span className="kiki-os-brand-name">KIKI OS</span>
        <span className="kiki-os-brand-product">TERMINAL-LAB</span>
      </span>
    </span>
  );
}
