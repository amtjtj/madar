import nextVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';

import base from './base.js';

// Physical-direction Tailwind utilities break RTL. Use ms-/me-/ps-/pe-/start-/end-/text-start/text-end.
const PHYSICAL_CLASS = String.raw`/(^|\s|:)-?(ml|mr|pl|pr|left|right|text-left|text-right|rounded-l|rounded-r|border-l|border-r|scroll-ml|scroll-mr)(-|\s|$)/`;
const RTL_MESSAGE =
  'Use logical Tailwind utilities (ms-*, me-*, ps-*, pe-*, start-*, end-*, text-start, text-end) — the UI is RTL-first.';

export default tseslint.config(...nextVitals, ...base, {
  rules: {
    'no-restricted-syntax': [
      'error',
      { selector: `Literal[value=${PHYSICAL_CLASS}]`, message: RTL_MESSAGE },
      { selector: `TemplateElement[value.raw=${PHYSICAL_CLASS}]`, message: RTL_MESSAGE },
    ],
  },
});
