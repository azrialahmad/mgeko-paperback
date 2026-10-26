import {
    Chapter,
    ChapterDetails,
    ChapterProviding,
    ContentRating,
    DUISection,
    HomePageSectionsProviding,
    HomeSection,
    HomeSectionType,
    MangaProviding,
    PagedResults,
    Request,
    Response,
    SearchRequest,
    SearchResultsProviding,
    SourceInfo,
    SourceIntents,
    SourceManga,
    Tag,
    TagSection
} from '@paperback/types'
import { CheerioAPI, load } from 'cheerio'

import {
    FALLBACK_GENRES,
    ViewPeriod,
    cardToPartial,
    genreTag,
    parseBrowseCards,
    parseChapterDetails,
    parseChapters,
    parseGenreList,
    parseMangaDetails
} from './MgekoParser'
import {
    HOME_SECTIONS,
    getEnabledSections,
    getShowNsfw,
    getSubtitleMode,
    settingsButton
} from './MgekoSettings'

const BASE_URL = 'https://www.mgeko.cc'

export const MgekoInfo: SourceInfo = {
    version: '1.0.1',
    name: 'Mgeko',
    icon: 'icon.png',
    author: 'Azrial Ahmad',
    authorWebsite: 'https://github.com/azrialahmad',
    description: 'Extension that pulls manga from mgeko.cc, with ratings and views on every list.',
    contentRating: ContentRating.MATURE,
    websiteBaseURL: BASE_URL,
    sourceTags: [],
    intents: SourceIntents.MANGA_CHAPTERS
        | SourceIntents.HOMEPAGE_SECTIONS
        | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
        | SourceIntents.SETTINGS_UI
}

const SORT_OPTIONS: { id: string, label: string }[] = [
    { id: 'latest', label: 'Latest update' },
    { id: 'recently_added', label: 'Recently added' },
    { id: 'popular_daily', label: 'Popular daily' },
    { id: 'popular_weekly', label: 'Popular weekly' },
    { id: 'popular_monthly', label: 'Popular monthly' },
    { id: 'popular_all_time', label: 'Popular all time' },
    { id: 'rating', label: 'Top rated' },
    { id: 'az', label: 'Title A-Z' },
    { id: 'za', label: 'Title Z-A' }
]
const STATUS_OPTIONS = ['ongoing', 'completed', 'hiatus']
const TYPE_OPTIONS = ['manga', 'manhwa', 'manhua', 'webtoon']

interface BrowseMetadata {
    page: number
}

interface BrowseResponse {
    results_html?: string
    num_pages?: number | string
    page?: number | string
}

const viewPeriodFor = (sort: string | undefined): ViewPeriod => {
    if (sort === 'popular_weekly') return 'weekly'
    if (sort === 'popular_monthly') return 'monthly'
    return 'best'
}

export class Mgeko implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {
    stateManager = App.createSourceStateManager()

    requestManager = App.createRequestManager({
        requestsPerSecond: 5,
        requestTimeout: 20000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    referer: `${BASE_URL}/`,
                    'user-agent': await this.requestManager.getDefaultUserAgent()
                }
                return request
            },
            interceptResponse: async (response: Response): Promise<Response> => response
        }
    })

    // -----------------------------------------------------------------------
    // Settings
    // -----------------------------------------------------------------------

    async getSourceMenu(): Promise<DUISection> {
        return App.createDUISection({
            id: 'main',
            header: 'Source Settings',
            isHidden: false,
            rows: async () => [settingsButton(this.stateManager)]
        })
    }

    // -----------------------------------------------------------------------
    // Manga
    // -----------------------------------------------------------------------

    getMangaShareUrl(mangaId: string): string {
        return `${BASE_URL}/manga/${mangaId}/`
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const $ = await this.fetchHtml(`${BASE_URL}/manga/${mangaId}/`)
        return parseMangaDetails($, mangaId)
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        // all-chapters lists everything; the series page only shows the most recent ones.
        try {
            const $ = await this.fetchHtml(`${BASE_URL}/manga/${mangaId}/all-chapters/`)
            return parseChapters($, mangaId)
        } catch (error) {
            if (String(error).includes('CLOUDFLARE')) throw error
            const $ = await this.fetchHtml(`${BASE_URL}/manga/${mangaId}/`)
            return parseChapters($, mangaId)
        }
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const $ = await this.fetchHtml(`${BASE_URL}/reader/en/${chapterId}/`)
        return parseChapterDetails($, mangaId, chapterId)
    }

    // -----------------------------------------------------------------------
    // Homepage
    // -----------------------------------------------------------------------

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const enabled = await getEnabledSections(this.stateManager)
        const defs = HOME_SECTIONS.filter(s => enabled.includes(s.id))

        const sections = defs.map(def => {
            const section = App.createHomeSection({
                id: def.id,
                title: def.title,
                type: def.large ? HomeSectionType.singleRowLarge : HomeSectionType.singleRowNormal,
                containsMoreItems: true
            })
            sectionCallback(section)
            return section
        })

        await Promise.all(sections.map(async section => {
            const result = await this.browse({ sort: section.id }, 1)
            section.items = result.results
            sectionCallback(section)
        }))
    }

    async getViewMoreItems(homepageSectionId: string, metadata: BrowseMetadata | undefined): Promise<PagedResults> {
        if (!HOME_SECTIONS.some(s => s.id === homepageSectionId)) {
            throw new Error(`Unknown homepage section: ${homepageSectionId}`)
        }
        return this.browse({ sort: homepageSectionId }, metadata?.page ?? 1)
    }

    // -----------------------------------------------------------------------
    // Search
    // -----------------------------------------------------------------------

    async getSearchTags(): Promise<TagSection[]> {
        let genres = FALLBACK_GENRES
        try {
            genres = parseGenreList(await this.fetchHtml(`${BASE_URL}/browse-comics/`))
        } catch {
            // keep the built-in list
        }

        return [
            App.createTagSection({
                id: 'sort',
                label: 'Sort by (pick one)',
                tags: SORT_OPTIONS.map(s => App.createTag({ id: `sort.${s.id}`, label: s.label }))
            }),
            App.createTagSection({
                id: 'status',
                label: 'Status (pick one)',
                tags: STATUS_OPTIONS.map(s => App.createTag({ id: `status.${s}`, label: capitalize(s) }))
            }),
            App.createTagSection({
                id: 'type',
                label: 'Type (pick one)',
                tags: TYPE_OPTIONS.map(t => App.createTag({ id: `type.${t}`, label: capitalize(t) }))
            }),
            App.createTagSection({
                id: 'genres',
                label: 'Genres',
                tags: genres.map(genreTag)
            })
        ]
    }

    async supportsTagExclusion(): Promise<boolean> {
        return true
    }

    async getSearchResults(query: SearchRequest, metadata: BrowseMetadata | undefined): Promise<PagedResults> {
        const params: Record<string, string> = {}

        const title = query.title?.trim()
        if (title) params.q = title

        const pick = (tags: Tag[], prefix: string): string[] =>
            tags.filter(t => t.id.startsWith(`${prefix}.`)).map(t => t.id.slice(prefix.length + 1))

        const included = query.includedTags ?? []
        const excluded = query.excludedTags ?? []

        const sort = pick(included, 'sort')[0]
        const status = pick(included, 'status')[0]
        const type = pick(included, 'type')[0]
        const includeGenres = pick(included, 'genre')
        const excludeGenres = pick(excluded, 'genre')

        if (sort) params.sort = sort
        if (status) params.status = status
        if (type) params.type = type
        if (includeGenres.length) params.include_genres = includeGenres.join(',')
        if (excludeGenres.length) params.exclude_genres = excludeGenres.join(',')

        return this.browse(params, metadata?.page ?? 1)
    }

    // -----------------------------------------------------------------------
    // Networking
    // -----------------------------------------------------------------------

    /**
     * Every list on the site (homepage rows, "view more", search, genre filters) goes through
     * /browse-comics/data/, which returns JSON with the cards as an HTML string plus `num_pages`.
     * Requesting a page past the end silently returns the last page again, so paging has to stop
     * on `num_pages` or the list repeats forever.
     */
    private async browse(params: Record<string, string>, page: number): Promise<PagedResults> {
        const [mode, nsfw] = await Promise.all([
            getSubtitleMode(this.stateManager),
            getShowNsfw(this.stateManager)
        ])

        const query = { ...params, page: String(page), safe_mode: nsfw ? '0' : '1' }
        const qs = Object.entries(query)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&')

        const response = await this.request(`${BASE_URL}/browse-comics/data/?${qs}`)
        let data: BrowseResponse
        try {
            data = JSON.parse(response.data ?? '') as BrowseResponse
        } catch {
            throw new Error(`Mgeko returned an unexpected response (HTTP ${response.status}).`)
        }

        const numPages = Number(data.num_pages) || 1
        const period = viewPeriodFor(params.sort)
        const results = page > numPages
            ? []
            : parseBrowseCards(data.results_html ?? '').map(card => cardToPartial(card, mode, period))

        return App.createPagedResults({
            results,
            metadata: page < numPages && results.length > 0 ? { page: page + 1 } : undefined
        })
    }

    private async fetchHtml(url: string): Promise<CheerioAPI> {
        const response = await this.request(url)
        return load(response.data ?? '')
    }

    private async request(url: string): Promise<Response> {
        const response = await this.requestManager.schedule(App.createRequest({ url, method: 'GET' }), 1)
        this.checkCloudflare(response.status)
        if (response.status >= 400) {
            throw new Error(`Mgeko request failed (HTTP ${response.status}): ${url}`)
        }
        return response
    }

    private checkCloudflare(status: number): void {
        if (status === 503 || status === 403) {
            throw new Error('CLOUDFLARE BYPASS ERROR:\nPlease go to the homepage of Mgeko and press the cloud icon.')
        }
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        return App.createRequest({
            url: BASE_URL,
            method: 'GET',
            headers: {
                referer: `${BASE_URL}/`,
                'user-agent': await this.requestManager.getDefaultUserAgent()
            }
        })
    }
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
