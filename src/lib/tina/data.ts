import { requestWithMetadata } from '@tinacms/astro/data';
import client from '../../../tina/__generated__/client';

export const getDoc = (slug: string) =>
  requestWithMetadata(client.queries.docs({ relativePath: slug + '.mdx' }), {
    priority: 'primary',
  });
