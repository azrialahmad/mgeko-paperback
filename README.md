# Mgeko for Paperback 0.8

Paperback 0.8 source for [mgeko.cc](https://www.mgeko.cc).

- Every list (homepage rows, "view more", search) shows **⭐ rating · 👁 views** under each title.
- Homepage: Popular Today, Latest Updates, Popular This Week, New Series, Popular This Month, Most Viewed, Top Rated. "View more" pages correctly and stops on the last page.
- Search by title plus filters: sort, status, type, and include/exclude genres.
- The series page description opens with rating (and vote count), total views, bookmarks and last update.
- Settings: what to show under titles (rating + views / rating / views / nothing), show NSFW, which homepage rows to load.

## Develop

```bash
npm install
npm run build     # typecheck
npm run bundle    # writes bundles/
npm test          # live smoke test against mgeko.cc (needs a bundle)
npm run serve     # serve a repo to add from Paperback on the same network
```

## Notes on the site

Everything list-shaped comes from `GET /browse-comics/data/?sort=…&page=…`, which returns JSON
(`results_html`, `num_pages`, `total_results`). Asking for a page past `num_pages` returns the last page
again, so paging stops on `num_pages`. NSFW titles are hidden unless `safe_mode=0`.

The per-card view counters (`stat-weekly` / `stat-monthly` / `stat-alltime`) are the site's own and don't
match the total on the series page (all-time is often lower than monthly). Lists sorted weekly/monthly show
that period's number; other lists show the largest of the three. The details page shows the true total.

## Publishing

Pushing to `main` runs `.github/workflows/publish.yml`, which bundles into the `gh-pages` branch under `0.8/`.
Enable GitHub Pages on `gh-pages`, then add `https://azrialahmad.github.io/mgeko-paperback/0.8` in Paperback.
