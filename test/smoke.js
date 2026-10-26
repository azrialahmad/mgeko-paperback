// Live smoke test: runs the bundled source against mgeko.cc with a minimal fake of Paperback's `App` runtime.
// Usage: npm run bundle && npm test
const path = require('path')

const state = new Map()
const passthrough = (x) => x

global.App = {
    createRequestManager: (info) => ({
        getDefaultUserAgent: async () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        schedule: async (request) => {
            const req = info.interceptor ? await info.interceptor.interceptRequest(request) : request
            const res = await fetch(req.url, { method: req.method, headers: req.headers })
            return { data: await res.text(), status: res.status, headers: {}, request: req }
        }
    }),
    createSourceStateManager: () => ({
        store: async (k, v) => { state.set(k, v) },
        retrieve: async (k) => state.get(k),
        keychain: { store: async () => {}, retrieve: async () => undefined }
    }),
    createRequest: passthrough,
    createHomeSection: (info) => ({ items: [], ...info }),
    createPartialSourceManga: passthrough,
    createPagedResults: (info) => ({ results: [], ...info }),
    createSourceManga: passthrough,
    createMangaInfo: passthrough,
    createTagSection: passthrough,
    createTag: passthrough,
    createChapter: passthrough,
    createChapterDetails: passthrough,
    createDUISection: passthrough,
    createDUINavigationButton: passthrough,
    createDUIForm: passthrough,
    createDUISelect: passthrough,
    createDUISwitch: passthrough,
    createDUIBinding: passthrough
}

const { Sources } = require(path.join(__dirname, '..', 'bundles', 'Mgeko', 'source.js'))
const source = new Sources.Mgeko()

let failures = 0
const check = (cond, msg) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`)
    if (!cond) failures++
}

const show = (items, n = 3) => items.slice(0, n).map(i => `      ${i.title}  [${i.subtitle ?? ''}]`).join('\n')

;(async () => {
    // Homepage
    const sections = new Map()
    await source.getHomePageSections((s) => sections.set(s.id, s))
    for (const s of sections.values()) {
        check(s.items.length > 0 && s.items.every(i => i.mangaId && i.title && i.image), `home "${s.title}": ${s.items.length} items`)
        console.log(show(s.items, 2))
    }
    const subtitled = [...sections.values()].flatMap(s => s.items).filter(i => /⭐/.test(i.subtitle ?? '') && /👁/.test(i.subtitle ?? ''))
    check(subtitled.length > 0, `cards show stars + views (${subtitled.length} with both)`)

    // View more paging: page 1 -> 2 -> 3, no repeats
    const p1 = await source.getViewMoreItems('popular_all_time', undefined)
    const p2 = await source.getViewMoreItems('popular_all_time', p1.metadata)
    const p3 = await source.getViewMoreItems('popular_all_time', p2.metadata)
    const ids = [...p1.results, ...p2.results, ...p3.results].map(i => i.mangaId)
    check(p1.metadata?.page === 2 && p2.metadata?.page === 3, 'view more advances pages')
    check(new Set(ids).size === ids.length, `view more has no duplicates across 3 pages (${ids.length} items)`)

    // Last page stops
    const last = await source.getSearchResults({ title: 'solo leveling', includedTags: [], excludedTags: [] }, undefined)
    check(last.results.length > 0, `search "solo leveling": ${last.results.length} results`)
    console.log(show(last.results))

    // Filters
    const filtered = await source.getSearchResults({
        includedTags: [{ id: 'sort.rating' }, { id: 'type.manhwa' }, { id: 'genre.Action' }],
        excludedTags: [{ id: 'genre.Romance' }]
    }, undefined)
    check(filtered.results.length > 0, `filtered search (top rated manhwa, action, no romance): ${filtered.results.length}`)
    console.log(show(filtered.results))

    const tags = await source.getSearchTags()
    check(tags.find(t => t.id === 'genres')?.tags.length > 20, `search tags: ${tags.map(t => `${t.id}=${t.tags.length}`).join(', ')}`)

    // Details / chapters / pages
    const mangaId = p1.results[0].mangaId
    const details = await source.getMangaDetails(mangaId)
    const info = details.mangaInfo
    check(info.titles[0] && info.image && info.desc, `details for ${mangaId}: "${info.titles[0]}" status=${info.status} rating=${info.rating}`)
    console.log('      ' + info.desc.split('\n')[0])
    console.log('      tags: ' + info.tags.flatMap(t => t.tags.map(x => x.id)).join(', '))

    const chapters = await source.getChapters(mangaId)
    const c0 = chapters[0]
    check(chapters.length > 0 && c0.time instanceof Date && !isNaN(c0.time), `chapters: ${chapters.length}, newest "${c0.name}" #${c0.chapNum} at ${c0.time.toISOString()}`)
    const unnumbered = chapters.filter(c => !c.chapNum && !/chapter-0(?:\D|$)/.test(c.id))
    check(unnumbered.length === 0, `all chapters have a number (unparsed: ${unnumbered.map(c => c.id).slice(0, 5).join(', ') || 'none'})`)
    const sorted = chapters.every((c, i) => i === 0 || chapters[i - 1].sortingIndex > c.sortingIndex)
    check(sorted, 'chapter sortingIndex is newest-first')

    const pages = await source.getChapterDetails(mangaId, c0.id)
    check(pages.pages.length > 0 && pages.pages.every(p => /^https?:/.test(p)), `chapter pages: ${pages.pages.length}`)
    console.log('      ' + pages.pages[0])

    // Settings change the subtitle
    await state.set('subtitle_mode', 'rating')
    const ratingOnly = await source.getViewMoreItems('latest', undefined)
    check(ratingOnly.results.every(i => !/👁/.test(i.subtitle ?? '')), 'subtitle setting "rating only" is respected')

    console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed')
    process.exit(failures ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
