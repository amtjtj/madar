import Link from 'next/link';

import type { LinkComponent } from '@madar/ui';

/** Next.js links for design-system components that take a `link` prop. */
export const NextLink: LinkComponent = ({ href, children, ...props }) => (
  <Link href={href} {...props}>
    {children}
  </Link>
);
