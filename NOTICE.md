# Attribution

Terminal Lab Community reuses the general user and administrator implementation from the local Terminal Lab working tree. `platform/SOURCE-PROVENANCE.json` records source file hashes and the retained/removed route inventory. The standalone distribution has no original Git history, operating data, credentials or training content. Shared modules and empty education compatibility tables remain as documented in README.

Project code in this distribution is provided under MIT. Third-party code retains its original license. React, xterm.js and MDXEditor use MIT; noVNC uses MPL-2.0.

Maintainer: Choi Gook Hyun (tangt64), https://github.com/tangt64. Project inquiries: tang@dustbox.kr. See AUTHORS.md for project attribution; third-party copyright notices remain applicable.

Sharp is distributed under Apache-2.0; its native packages include libvips and other components with LGPL and additional notices. The project's MIT license does not replace those terms. Review the installed dependency licenses and https://sharp.pixelplumbing.com/install/#licensing when redistributing compiled applications or container images. The source distribution excludes node_modules and runtime images.

`npm run build` generates browser dependency notices and copies them into `platform/dist/licenses/`. The noVNC npm package is unmodified; its matching source is available from the resolved package tarball in `package-lock.json` and https://github.com/novnc/noVNC/tree/v1.5.0. Installed server dependencies retain their license files. Node, PostgreSQL, kubectl and runtime image components retain upstream licenses.

