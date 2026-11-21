# Attribution

KIKI OS TERMINAL-LAB Community reuses the general user and administrator implementation from the local Terminal Lab working tree. `platform/SOURCE-PROVENANCE.json` records source file hashes and the retained/removed route inventory. The standalone distribution has no original Git history, operating data, credentials or training content. The active runtime excludes education tables and authoring state. Installed historical records are preserved in a generic archive; migration and backup identifiers remain for data compatibility as documented in README.

Project code in this distribution is provided under MIT. Third-party code retains its original license. React and xterm.js use MIT; noVNC uses MPL-2.0.

Maintainer: Choi Gook Hyun (tangt64), https://github.com/tangt64. Project inquiries: tang@dustbox.kr. See AUTHORS.md for project attribution; third-party copyright notices remain applicable.

`npm run build` generates browser dependency notices and copies them into `platform/dist/licenses/`. The noVNC npm package is unmodified; its matching source is available from the resolved package tarball in `package-lock.json` and https://github.com/novnc/noVNC/tree/v1.5.0. Installed server dependencies retain their license files. Node, PostgreSQL, kubectl and runtime image components retain upstream licenses.


## KIKIOS brand asset

`platform/client/public/brand/kikios-kiki-wordmark-v1.png` is the unchanged yellow KIKI logo from the KIKI-OS project by Choi Gook Hyun. `kikios-yellow-mascot.svg` retains the mascot shapes from its existing vector source with a square canvas and no wordmark. Their sources, SHA-256 hashes and retained GPL v3 license are documented in [the brand notice](platform/client/public/brand/ORIGIN.md). The application code remains MIT licensed.
