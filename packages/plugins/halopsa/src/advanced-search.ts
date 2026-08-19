// builds HaloPSA `advanced_search` filter JSON from friendly date_from/date_to tool params.

// filter_type enum from HaloPSA support
export const FILTER_TYPE = {
  IN: 0,
  NOT_IN: 1,
  EQUALS: 2,
  NOT_EQUALS: 3,
  LIKE: 4,
  NOT_LIKE: 5,
  EQUALS_ALT: 6,
  GT: 7,
  GTE: 8,
  LT: 9,
  LTE: 10,
} as const

export interface AdvancedSearchFilter {
  filter_name: string
  filter_type: number
  filter_value: string
}

export interface DateRangeInput {
  date_from?: string
  date_to?: string
  advanced_search?: string
  // additional date-range filters on other DB columns, merged into the same advanced_search payload
  extra_dates?: Array<{ field: string; from?: string; to?: string }>
}

export interface BuildResult {
  advanced_search?: string
  error?: string
}

// dateField is the DB column name on the target endpoint (e.g. 'dateoccurred', 'qhdate')
export function buildAdvancedSearch(dateField: string, input: DateRangeInput): BuildResult {
  const filters: AdvancedSearchFilter[] = []

  if (input.date_from) {
    filters.push({ filter_name: dateField, filter_type: FILTER_TYPE.GTE, filter_value: input.date_from })
  }
  if (input.date_to) {
    filters.push({ filter_name: dateField, filter_type: FILTER_TYPE.LTE, filter_value: input.date_to })
  }
  if (input.extra_dates) {
    for (const spec of input.extra_dates) {
      if (spec.from) {
        filters.push({ filter_name: spec.field, filter_type: FILTER_TYPE.GTE, filter_value: spec.from })
      }
      if (spec.to) {
        filters.push({ filter_name: spec.field, filter_type: FILTER_TYPE.LTE, filter_value: spec.to })
      }
    }
  }
  if (input.advanced_search) {
    try {
      const extra = JSON.parse(input.advanced_search)
      if (Array.isArray(extra)) {
        filters.push(...extra)
      }
    } catch {
      return { error: `Invalid advanced_search JSON: ${input.advanced_search}` }
    }
  }

  if (filters.length === 0) {
    return {}
  }
  return { advanced_search: JSON.stringify(filters) }
}

// shared param descriptions for consistency across tools
export const ADVANCED_SEARCH_PARAM_DESCRIPTIONS = {
  date_from: (fieldLabel: string) =>
    `Only include records with ${fieldLabel} on or after this date (ISO 8601, e.g. "2026-01-01T00:00:00Z"). Uses advanced_search.`,
  date_to: (fieldLabel: string) =>
    `Only include records with ${fieldLabel} on or before this date (ISO 8601, e.g. "2026-02-01T00:00:00Z"). Uses advanced_search.`,
  advanced_search:
    'HaloPSA advanced_search as a JSON array of {filter_name, filter_type, filter_value} objects. filter_type enum: 0=IN, 1=NOT_IN, 2=EQ, 3=NEQ, 4=LIKE, 5=NOT_LIKE, 7=GT, 8=GTE, 9=LT, 10=LTE. filter_value is always a string (ISO 8601 for dates). Example (tickets closed Jan->Apr 2026): [{"filter_name":"datecleared","filter_type":8,"filter_value":"2026-01-01T00:00:00Z"},{"filter_name":"datecleared","filter_type":10,"filter_value":"2026-04-30T23:59:59Z"}]. Prefer date_from/date_to for simple ranges on the default date column.',
}
