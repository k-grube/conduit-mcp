import type { HuduClient } from './client.js'

export const huduCompanyUrl = (item: Record<string, unknown>, client: HuduClient) => ({
  ...item,
  url: `${client.baseUrl}/c/${item.slug}`,
  kb_url: `${client.baseUrl}/kba?company_id=${item.slug}`,
})

export const huduArticleUrl = (item: Record<string, unknown>, client: HuduClient) => ({
  ...item,
  url: `${client.baseUrl}/kba/${item.slug}`,
})

export const huduAssetUrl = (item: Record<string, unknown>, client: HuduClient) => ({
  ...item,
  url: `${client.baseUrl}/a/${item.slug}`,
})
