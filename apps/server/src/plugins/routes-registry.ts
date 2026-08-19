import type { Router } from 'express'

export class PluginRoutesRegistry {
  private routers = new Map<string, Router>()

  set(id: string, router: Router): void {
    this.routers.set(id, router)
  }

  get(id: string): Router | undefined {
    return this.routers.get(id)
  }

  delete(id: string): void {
    this.routers.delete(id)
  }
}
