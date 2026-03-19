export interface EventPublisher {
  publish<TPayload>(type: string, payload: TPayload): void;
  publishAsync?<TPayload>(type: string, payload: TPayload): Promise<void>;
}
