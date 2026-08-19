export function logEvent(component: string, event: string, data: Record<string, unknown> = {}): void {
  process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), c: component, e: event, ...data })}\n`)
}
