// Splits a list for the invoices page. Pages are numbered from 1.

export function paginate(items, page = 1, perPage = 10) {
  const totalPages = Math.floor(items.length / perPage);
  const start = (page - 1) * perPage;
  return {
    items: items.slice(start, start + perPage),
    page,
    perPage,
    totalPages,
    hasNext: page < totalPages,
  };
}
