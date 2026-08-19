export const ninjaOrgUrl = (item: Record<string, unknown>, client: { baseUrl: string }) => ({
  ...item,
  url: `${client.baseUrl}/#/customerDashboard/${item.id}/overview`,
})

export const ninjaDeviceUrl = (item: Record<string, unknown>, client: { baseUrl: string }) => ({
  ...item,
  url: `${client.baseUrl}/#/deviceDashboard/${item.id}/overview`,
})
