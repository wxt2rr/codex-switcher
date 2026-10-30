export interface SelectHoverRegistration {
  close: () => void;
  cancelPendingOpen: () => void;
}

/**
 * Coordinates the hover-enhanced Select instances.
 *
 * Select content is rendered in a portal, so relying on DOM ancestry cannot
 * guarantee that two controls do not remain open at the same time. Keeping a
 * tiny module-level coordinator gives all instances one active owner while
 * leaving click-only Selects completely outside this interaction model.
 */
export class SelectHoverCoordinator {
  private readonly registrations = new Map<string, SelectHoverRegistration>();
  private activeId: string | null = null;

  register(id: string, registration: SelectHoverRegistration) {
    this.registrations.set(id, registration);
    return () => this.unregister(id);
  }

  unregister(id: string) {
    this.registrations.delete(id);
    if (this.activeId === id) this.activeId = null;
  }

  activate(id: string) {
    if (!this.registrations.has(id)) return;

    for (const [otherId, registration] of this.registrations) {
      if (otherId === id) continue;
      registration.cancelPendingOpen();
      registration.close();
    }
    this.activeId = id;
  }

  release(id: string) {
    if (this.activeId === id) this.activeId = null;
  }

  getActiveId() {
    return this.activeId;
  }

  reset() {
    for (const registration of this.registrations.values()) {
      registration.cancelPendingOpen();
      registration.close();
    }
    this.activeId = null;
  }
}

export const selectHoverCoordinator = new SelectHoverCoordinator();

export const SELECT_HOVER_OPEN_DELAY = 120;
export const SELECT_HOVER_CLOSE_DELAY = 160;
