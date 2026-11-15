// @ts-nocheck (generated types/client appear after your first tinacms dev run)
import type { IslandRegistry } from '@tinacms/astro/experimental';
import type { QueryResult } from '@tinacms/astro/data';
import type { DocsQuery } from '../../../tina/__generated__/types';
import DocsBody from '../../components/tina/DocsBody.astro';
import DocsTitle from '../../components/tina/DocsTitle.astro';
import { getDoc } from './data';

export const islands: IslandRegistry = {
  docsTitle: {
    fetch: (_request, params) => getDoc(params.get('slug') ?? ''),
    component: DocsTitle,
    wrapper: { tag: 'div' },
    propsFromData: (data) => ({
      data: (data as QueryResult<DocsQuery>).data?.docs,
    }),
  },
  docs: {
    fetch: (_request, params) => getDoc(params.get('slug') ?? ''),
    component: DocsBody,
    wrapper: { tag: 'div' },
    propsFromData: (data) => ({
      data: (data as QueryResult<DocsQuery>).data?.docs,
    }),
  },
};
