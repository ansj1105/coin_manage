import { EventEmitter } from 'node:events';

export interface DomainEvent<TPayload = Record<string, unknown>> {
  type: string;
  payload: TPayload;
  occurredAt: string;
}

export class EventBus {
  private readonly emitter = new EventEmitter();

  publish<TPayload>(type: string, payload: TPayload): void {
    const event: DomainEvent<TPayload> = {
      type,
      payload,
      occurredAt: new Date().toISOString()
    };
    this.emitter.emit(type, event);
    this.emitter.emit('*', event);
  }

  subscribe<TPayload>(type: string, handler: (event: DomainEvent<TPayload>) => void): void {
    this.emitter.on(type, handler as (event: DomainEvent) => void);
  }
}
