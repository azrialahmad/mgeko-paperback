import {
    Chapter,
    ChapterDetails,
    PartialSourceManga,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'
import { CheerioAPI, load } from 'cheerio'

import { SubtitleMode } from './MgekoSettings'

// ---------------------------------------------------------------------------
// Browse cards (the /browse-comics/data/ API returns them as an HTML string)
// ---------------------------------------------------------------------------

export type ViewPeriod = 'weekly' | 'monthly' | 'best'

export interface BrowseCard {
    id: string
    title: string
    image: string
    rating?: number
    views: { weekly?: number, monthly?: number, alltime?: number }
}

export const parseBrowseCards = (html: string): BrowseCard[] => {
    const $ = load(html)
    const cards: BrowseCard[] = []
    const seen = new Set<string>()

    for (const card of $('article.comic-card').toArray()) {
        const link = $('.comic-card__title a', card).first()
        const id = slugFromHref(link.attr('href') ?? $('a', card).first().attr('href'))
        if (!id || seen.has(id)) continue
        seen.add(id)

        const img = $('.comic-card__cover img', card).first()
        const title = link.text().trim() || img.attr('alt')?.trim() || id

        const ratingText = $('.comic-card__stat--rating', card).text()
        const ratingMatch = ratingText.match(/(\d+(?:\.\d+)?)/)

        cards.push({
            id,
            title,
            image: img.attr('data-src') ?? img.attr('src') ?? '',
            rating: ratingMatch ? Number(ratingMatch[1]) : undefined,
            views: {
                weekly: parseCount($('.stat-weekly', card).text()),
                monthly: parseCount($('.stat-monthly', card).text()),
                alltime: parseCount($('.stat-alltime', card).text())
            }
        })
    }
    return cards
}

export const cardToPartial = (card: BrowseCard, mode: SubtitleMode, period: ViewPeriod): PartialSourceManga => {
    return App.createPartialSourceManga({
        mangaId: card.id,
        title: card.title,
        image: card.image,
        subtitle: buildSubtitle(card, mode, period)
    })
}

const buildSubtitle = (card: BrowseCard, mode: SubtitleMode, period: ViewPeriod): string | undefined => {
    const parts: string[] = []
    if ((mode === 'both' || mode === 'rating') && card.rating !== undefined) {
        parts.push(`⭐ ${card.rating.toFixed(1)}`)
    }
    if (mode === 'both' || mode === 'views') {
        const views = pickViews(card, period)
        if (views !== undefined) parts.push(`👁 ${formatCount(views)}`)
    }
    return parts.length ? parts.join(' · ') : undefined
}

const pickViews = (card: BrowseCard, period: ViewPeriod): number | undefined => {
    const { weekly, monthly, alltime } = card.views
    if (period === 'weekly' && weekly !== undefined) return weekly
    if (period === 'monthly' && monthly !== undefined) return monthly
    // The site's per-card counters are inconsistent (all-time is often lower than monthly),
    // so outside of a period-specific list show the largest one.
    const all = [weekly, monthly, alltime].filter((x): x is number => x !== undefined)
    return all.length ? Math.max(...all) : undefined
}

// ---------------------------------------------------------------------------
// Series page
// ---------------------------------------------------------------------------

export const parseMangaDetails = ($: CheerioAPI, mangaId: string): SourceManga => {
    const header = $('header.novel-header')

    const title = header.find('h1.novel-title').first().text().trim()
        || $('.fixed-img img').attr('alt')?.trim()
        || mangaId
    const altTitles = header.find('h2.alternative-title').first().text()
        .split(',')
        .map(x => x.trim())
        .filter(x => x && x !== title)

    const coverImg = header.find('.fixed-img img, .cover img').first()
    const image = coverImg.attr('data-src') ?? coverImg.attr('src') ?? ''

    const author = header.find('.author [itemprop="author"]').toArray()
        .map(el => $(el).text().trim())
        .filter(Boolean)
        .join(', ')

    // "4.2 (72)"
    const ratingText = header.find('.rating-star strong').first().text().trim()
    const ratingMatch = ratingText.match(/(\d+(?:\.\d+)?)(?:\s*\((\d[\d,]*)\))?/)
    const rating = ratingMatch ? Number(ratingMatch[1]) : undefined
    const ratingVotes = ratingMatch?.[2]

    const stat = (label: string): string => {
        for (const span of header.find('.header-stats > span').toArray()) {
            if ($('small', span).text().trim().toLowerCase() === label) {
                // Drop the material-icons ligature text ("supervised_user_circle", "bookmark").
                const strong = $('strong', span).first().clone()
                strong.find('i').remove()
                return strong.text().replace(/\s+/g, ' ').trim()
            }
        }
        return ''
    }
    const views = stat('views').replace(/\s+/g, '')
    const bookmarks = stat('bookmarked').replace(/\s+/g, '')
    const rawStatus = stat('status')
    const lastUpdate = $('.updinfo strong').first().text().replace(/\s+/g, ' ').trim()

    const genres = $('.categories ul li a').toArray()
        .map(el => $(el).text().trim())
        .filter(Boolean)

    // The description starts with an SEO blurb ending in "The Summary is".
    let desc = $('p.description').first().text().trim()
    const summaryIdx = desc.indexOf('The Summary is')
    if (summaryIdx !== -1) desc = desc.slice(summaryIdx + 'The Summary is'.length).trim()

    const statsLine = [
        rating !== undefined ? `⭐ ${rating.toFixed(1)}${ratingVotes ? ` (${ratingVotes} votes)` : ''}` : '',
        views ? `👁 ${views} views` : '',
        bookmarks ? `🔖 ${bookmarks} bookmarks` : '',
        lastUpdate ? `🕒 updated ${lastUpdate} ago` : ''
    ].filter(Boolean).join('  ·  ')

    const tags: TagSection[] = genres.length
        ? [App.createTagSection({ id: 'genres', label: 'Genres', tags: genres.map(genreTag) })]
        : []

    return App.createSourceManga({
        id: mangaId,
        mangaInfo: App.createMangaInfo({
            titles: [title, ...altTitles],
            image,
            author,
            artist: author,
            desc: statsLine ? `${statsLine}\n\n${desc}` : desc,
            status: normalizeStatus(rawStatus),
            rating,
            tags,
            hentai: false
        })
    })
}

const normalizeStatus = (raw: string): string => {
    const s = raw.toLowerCase()
    if (s.includes('complete')) return 'Completed'
    if (s.includes('hiatus')) return 'Hiatus'
    return 'Ongoing'
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

export const parseChapters = ($: CheerioAPI, mangaId: string): Chapter[] => {
    const items = $('ul.chapter-list li').toArray()
    const chapters: Chapter[] = []
    const seen = new Set<string>()

    items.forEach((li, index) => {
        const link = $('a', li).first()
        const id = lastPathSegment(link.attr('href'))
        if (!id || seen.has(id)) return
        seen.add(id)

        const rawTitle = $('.chapter-title', li).text().replace(/\s+/g, ' ').trim()
        const chapNum = parseChapterNumber(rawTitle, id)
        const time = $('time.chapter-update', li)
        const date = parseSiteDate(time.attr('datetime') ?? '') ?? parseRelativeDate(time.text()) ?? new Date()

        chapters.push(App.createChapter({
            id,
            name: chapterName(rawTitle, chapNum),
            chapNum,
            time: date,
            langCode: '🇬🇧',
            // The list is newest-first.
            sortingIndex: items.length - index
        }))
    })

    if (chapters.length === 0) {
        throw new Error(`No chapters found for ${mangaId}`)
    }
    return chapters
}

// Titles look like "226-eng-li", "10.5-eng-li" or "10-5-eng-li".
const parseChapterNumber = (title: string, id: string): number => {
    const fromTitle = title.match(/^(\d+)(?:[.-](\d+)(?![a-z]))?/i)
    const m = fromTitle ?? id.match(/chapter-(\d+)(?:[.-](\d+)(?![a-z]))?/i)
    if (!m) return 0
    return Number(m[2] ? `${m[1]}.${m[2]}` : m[1])
}

const chapterName = (rawTitle: string, chapNum: number): string => {
    // Drop the scanlation/language suffix ("-eng-li") from the display name.
    const extra = rawTitle
        .replace(/^\d+(?:[.-]\d+(?![a-z]))?/i, '')
        .replace(/-?eng(?:-li)?\b/i, '')
        .replace(/^[\s:-]+/, '')
        .trim()
    return extra ? `Chapter ${chapNum} - ${extra}` : `Chapter ${chapNum}`
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

export const parseChapterDetails = ($: CheerioAPI, mangaId: string, chapterId: string): ChapterDetails => {
    let imgs = $('#chapter-reader img[id^="image-"]').toArray()
    if (imgs.length === 0) imgs = $('#chapter-reader img').toArray()

    const pages = imgs
        .map(img => ($(img).attr('data-src') ?? $(img).attr('src') ?? '').trim())
        .filter(src => src && !/credits-mgeko|placeholder/i.test(src))

    return App.createChapterDetails({ id: chapterId, mangaId, pages })
}

// ---------------------------------------------------------------------------
// Search tags
// ---------------------------------------------------------------------------

export const FALLBACK_GENRES = [
    'Action', 'Adventure', 'Comedy', 'Cooking', 'Drama', 'Fantasy', 'Gender bender', 'Harem',
    'Historical', 'Horror', 'Isekai', 'Josei', 'ladies', 'Manga', 'Manhua', 'Manhwa', 'Martial arts',
    'Mature', 'Mecha', 'Medical', 'Mystery', 'One shot', 'Psychological', 'Romance', 'School life',
    'Sci fi', 'Seinen', 'Shoujo', 'Shounen', 'Slice of life', 'Sports', 'Supernatural', 'Tragedy', 'Webtoons'
]

export const parseGenreList = ($: CheerioAPI): string[] => {
    const genres = $('.chip--include[data-group="include_genres"]').toArray()
        .map(el => $(el).attr('data-value')?.trim() ?? '')
        .filter(Boolean)
    return genres.length ? Array.from(new Set(genres)) : FALLBACK_GENRES
}

// Series pages list genres in any case ("ACTION", "Manhua "); the browse API matches them
// case-insensitively, so normalise to the browse page's spelling to keep tag ids consistent.
export const genreTag = (genre: string): Tag => {
    const clean = genre.trim()
    const known = FALLBACK_GENRES.find(g => g.toLowerCase() === clean.toLowerCase())
    const value = known ?? titleCase(clean.toLowerCase())
    return App.createTag({ id: `genre.${value}`, label: titleCase(value) })
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export const slugFromHref = (href: string | undefined): string => {
    const parts = (href ?? '').split('?')[0]?.split('/').filter(Boolean) ?? []
    const i = parts.indexOf('manga')
    return (i !== -1 ? parts[i + 1] : parts[parts.length - 1]) ?? ''
}

const lastPathSegment = (href: string | undefined): string => {
    const parts = (href ?? '').split('?')[0]?.split('/').filter(Boolean) ?? []
    return parts[parts.length - 1] ?? ''
}

const titleCase = (s: string): string => s.replace(/\b\w/g, c => c.toUpperCase())

const parseCount = (text: string): number | undefined => {
    const n = Number(text.replace(/[^\d]/g, ''))
    return text.trim() && !isNaN(n) ? n : undefined
}

export const formatCount = (n: number): string => {
    const fmt = (v: number, suffix: string) => `${v >= 100 ? Math.round(v) : Number(v.toFixed(1))}${suffix}`
    if (n >= 1e9) return fmt(n / 1e9, 'B')
    if (n >= 1e6) return fmt(n / 1e6, 'M')
    if (n >= 1e3) return fmt(n / 1e3, 'K')
    return String(n)
}

const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
}

// Django's default format: "Oct. 23, 2026, 4:25 p.m.", "Sept. 9, 2026, noon", "May 3, 2026, 5 a.m."
export const parseSiteDate = (value: string): Date | undefined => {
    const m = value.trim().match(/^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})(?:,\s*(.+))?$/)
    if (!m) return undefined
    const month = MONTHS[(m[1] ?? '').slice(0, 3).toLowerCase()]
    if (month === undefined) return undefined

    let hours = 0
    let minutes = 0
    const time = (m[4] ?? '').toLowerCase()
    if (time === 'noon') {
        hours = 12
    } else if (time !== 'midnight') {
        const t = time.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/)
        if (t) {
            hours = Number(t[1]) % 12 + (t[3] === 'p' ? 12 : 0)
            minutes = Number(t[2] ?? 0)
        }
    }
    return new Date(Date.UTC(Number(m[3]), month, Number(m[2]), hours, minutes))
}

const UNIT_MS: Record<string, number> = {
    minute: 60e3, hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 30 * 86400e3, year: 365 * 86400e3
}

// "2 days, 15 hours"
export const parseRelativeDate = (value: string): Date | undefined => {
    let total = 0
    for (const m of value.toLowerCase().matchAll(/(\d+)\s*(minute|hour|day|week|month|year)s?/g)) {
        total += Number(m[1]) * (UNIT_MS[m[2] ?? ''] ?? 0)
    }
    return total ? new Date(Date.now() - total) : undefined
}
