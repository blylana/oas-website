import { requestWithMetadata } from '@tinacms/astro/data';
import { serverClient, serverFetchOptions } from './server-client';

export const getDoc = (slug: string, request?: Request) =>
  requestWithMetadata(
    serverClient.queries.docs(
      { relativePath: slug + '.mdx' },
      request ? { fetchOptions: serverFetchOptions(request) } : undefined,
    ),
    {
      priority: 'primary',
    },
  );
