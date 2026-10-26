import { DUINavigationButton, SourceStateManager } from '@paperback/types'

export type SubtitleMode = 'both' | 'rating' | 'views' | 'none'

export interface HomeSectionDef {
    id: string      // also the site's `sort` value
    title: string
    large?: boolean
}

export const HOME_SECTIONS: HomeSectionDef[] = [
    { id: 'popular_daily', title: 'Popular Today', large: true },
    { id: 'latest', title: 'Latest Updates' },
    { id: 'popular_weekly', title: 'Popular This Week' },
    { id: 'recently_added', title: 'New Series' },
    { id: 'popular_monthly', title: 'Popular This Month' },
    { id: 'popular_all_time', title: 'Most Viewed' },
    { id: 'rating', title: 'Top Rated' }
]

const SUBTITLE_LABELS: Record<SubtitleMode, string> = {
    both: 'Rating + views',
    rating: 'Rating only',
    views: 'Views only',
    none: 'Nothing'
}

export const getSubtitleMode = async (state: SourceStateManager): Promise<SubtitleMode> =>
    ((await state.retrieve('subtitle_mode')) as SubtitleMode | undefined) ?? 'both'

export const getShowNsfw = async (state: SourceStateManager): Promise<boolean> =>
    ((await state.retrieve('show_nsfw')) as boolean | undefined) ?? false

export const getEnabledSections = async (state: SourceStateManager): Promise<string[]> =>
    ((await state.retrieve('home_sections')) as string[] | undefined) ?? HOME_SECTIONS.map(s => s.id)

export const settingsButton = (state: SourceStateManager): DUINavigationButton => {
    return App.createDUINavigationButton({
        id: 'settings',
        label: 'Settings',
        form: App.createDUIForm({
            sections: async () => [
                App.createDUISection({
                    id: 'display',
                    header: 'Display',
                    footer: 'What to show under each title in lists. Views follow the list\'s period (weekly/monthly) where the site provides it.',
                    isHidden: false,
                    rows: async () => [
                        App.createDUISelect({
                            id: 'subtitle_mode',
                            label: 'Show under titles',
                            options: Object.keys(SUBTITLE_LABELS),
                            allowsMultiselect: false,
                            labelResolver: async (option: string) => SUBTITLE_LABELS[option as SubtitleMode] ?? option,
                            value: App.createDUIBinding({
                                get: async () => [await getSubtitleMode(state)],
                                set: async (newValue: string[]) => state.store('subtitle_mode', newValue[0] ?? 'both')
                            })
                        })
                    ]
                }),
                App.createDUISection({
                    id: 'content',
                    header: 'Content',
                    isHidden: false,
                    rows: async () => [
                        App.createDUISwitch({
                            id: 'show_nsfw',
                            label: 'Show NSFW titles',
                            value: App.createDUIBinding({
                                get: async () => getShowNsfw(state),
                                set: async (newValue: boolean) => state.store('show_nsfw', newValue)
                            })
                        }),
                        App.createDUISelect({
                            id: 'home_sections',
                            label: 'Homepage sections',
                            options: HOME_SECTIONS.map(s => s.id),
                            allowsMultiselect: true,
                            labelResolver: async (option: string) => HOME_SECTIONS.find(s => s.id === option)?.title ?? option,
                            value: App.createDUIBinding({
                                get: async () => getEnabledSections(state),
                                set: async (newValue: string[]) => state.store('home_sections', newValue)
                            })
                        })
                    ]
                })
            ]
        })
    })
}
