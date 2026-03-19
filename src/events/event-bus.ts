export interface DomainEvent<TPayload = Record<string, unknown>> {
  type: string;
  payload: TPayload;
  occurredAt: string;
}

export class EventBus {
  private readonly handlers = new Map<string, Array<(event: DomainEvent) => void | Promise<void>>>();

  publish<TPayload>(type: string, payload: TPayload): void {
    const event: DomainEvent<TPayload> = {
      type,
      payload,
      occurredAt: new Date().toISOString()
    };
    for (const handler of this.getHandlers(type)) {
      void handler(event as DomainEvent);
    }
  }

  async publishAsync<TPayload>(type: string, payload: TPayload): Promise<void> {
    const event: DomainEvent<TPayload> = {
      type,
      payload,
      occurredAt: new Date().toISOString()
    };
    for (const handler of this.getHandlers(type)) {
      await handler(event as DomainEvent);
    }
  }

  subscribe<TPayload>(type: string, handler: (event: DomainEvent<TPayload>) => void | Promise<void>): void {
    const current = this.handlers.get(type) ?? [];
    current.push(handler as (event: DomainEvent) => void | Promise<void>);
    this.handlers.set(type, current);
  }

  private getHandlers(type: string) {
    return [...(this.handlers.get(type) ?? []), ...(type === '*' ? [] : this.handlers.get('*') ?? [])];
  }
}
