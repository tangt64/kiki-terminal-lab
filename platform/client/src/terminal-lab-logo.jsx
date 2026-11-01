export const COMMUNITY_BRAND_NAME = "KIKI OS TERMINAL-LAB";
export const KIKIOS_LOGO_PATH = "/brand/kikios-dark-blue-app-icon-v7.png";

export function getTerminalLabFaviconHref() {
  return KIKIOS_LOGO_PATH;
}

export default function TerminalLabLogo({ className = "", title = COMMUNITY_BRAND_NAME }) {
  return <img alt={title} className={`terminal-lab-logo kiki-os-symbol ${className}`.trim()} decoding="async" height="64" src={KIKIOS_LOGO_PATH} width="64" />;
}

export function TerminalLabBrand({ className = "", logoPath = "" }) {
  return (
    <span aria-label={COMMUNITY_BRAND_NAME} className={`kiki-os-brand ${className}`.trim()} role="img">
      {logoPath ? <img alt="" className="kiki-os-brand-symbol" src={logoPath} /> : <span aria-hidden="true" className="kiki-os-brand-symbol"><TerminalLabLogo /></span>}
      <span aria-hidden="true" className="kiki-os-brand-copy">
        <span className="kiki-os-brand-name">KIKIOS</span>
        <span className="kiki-os-brand-product">TERMINAL-LAB</span>
      </span>
    </span>
  );
}
