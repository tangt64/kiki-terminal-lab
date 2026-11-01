import release from "../../package.json" with { type: "json" };

export const PRODUCT_ID = release.name;
export const PRODUCT_VERSION = release.version;
export const PRODUCT_NAME = "KIKI OS TERMINAL-LAB";
