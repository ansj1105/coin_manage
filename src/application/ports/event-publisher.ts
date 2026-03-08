export interface EventPublisher {
  publish<TPayload>(type: string, payload: TPayload): void;
}
