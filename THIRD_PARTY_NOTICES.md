# Third-party notices

LocalAI Knowledge application code is MIT licensed. Its navigation and interface SVG icons were drawn for this project; no screenshot assets or CoWeft source code were copied. System fonts are used without bundling font files.

## Interface layout reference

The v0.1.2 conversation layout was informed by publicly visible DeepSeek interface screenshots, including [Learn Prompting's interface overview](https://learnprompting.org/blog/guide-deepseek-chatbot), linked from image search. The live [DeepSeek chat page](https://chat.deepseek.com/) returned HTTP 403 in this environment. This is a layout reference, not a claim of pixel-identical reproduction of the latest version. No screenshots, logos, source code, account data or other third-party assets are bundled. LocalAI retains its own name and original icons.

Runtime components:

| Component | Source | License |
| --- | --- | --- |
| Electron | https://github.com/electron/electron | MIT; bundled Chromium/Node and additional third-party notices accompany the runtime |
| React | https://github.com/facebook/react | MIT |
| React DOM | https://github.com/facebook/react | MIT |
| Scheduler (React dependency) | https://github.com/facebook/react | MIT |
| SQLite (through Node runtime) | https://www.sqlite.org/copyright.html | Public domain dedication; see runtime notices |

The packaged application retains Electron's LICENSE and LICENSES.chromium.html files. Do not remove them when redistributing. Build/test tools (Vite, TypeScript, Playwright, @electron/packager and transitive dependencies) retain their own licenses in node_modules; package-lock.json records the installed dependency graph.

## React, React DOM and Scheduler — MIT license

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Electron — MIT license

Copyright (c) Electron contributors
Copyright (c) 2013-2020 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## Local document parsing (v0.5.0)

- Mammoth 1.13.0 — https://github.com/mwilliamson/mammoth.js — BSD-2-Clause. Full license below and in packaged `node_modules/mammoth/LICENSE`. Its production dependencies are distributed with their original license files.
- unpdf 2.2.1 — https://github.com/unjs/unpdf — MIT. The complete original package and license are retained. It contains the serverless PDF.js 6.5.438 build; no upstream parser source is modified.
- PDF.js 6.5.438 — https://github.com/mozilla/pdf.js — Apache-2.0. Full license is in `dist-electron/electron/pdf-resources/PDFJS-LICENSE`. Adobe CMaps and standard font files retain the original licenses in their respective resource folders (`LICENSE`, `LICENSE_FOXIT`, `LICENSE_LIBERATION`).
- core-js polyfills bundled by PDF.js — https://github.com/zloirock/core-js — MIT, license copied to `pdf-resources/CORE-JS-LICENSE`.

The app calls parsers for plain-text extraction, never to render or execute document HTML/JavaScript. Runtime packaging includes only the parser package dependency closure; PDF.js's full development distribution and optional native rendering libraries are excluded. CMaps/font data are copied by `scripts/copy-pdf-resources.cjs`. Test fixtures are synthetic and authored for this project, with no private documents or third-party business materials.

### Mammoth — BSD-2-Clause

Copyright (c) 2013, Michael Williamson
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


### unpdf — MIT

MIT License

Copyright (c) 2023-PRESENT Johann Schopplich

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
