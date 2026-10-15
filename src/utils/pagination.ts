export interface PageQuery { page: number; limit: number }
export const skipOf = ({ page, limit }: PageQuery) => (page - 1) * limit;
export const pageMeta = (q: PageQuery, total: number, extra: Record<string, unknown> = {}) => {
  const pages = Math.ceil(total / q.limit);
  return { page: q.page, limit: q.limit, total, pages, hasNextPage: q.page < pages, hasPrevPage: q.page > 1 && total > 0, ...extra };
};
export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
