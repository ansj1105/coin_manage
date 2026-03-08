import { EventBus } from '../../events/event-bus.js';
import type { EventPublisher } from '../../application/ports/event-publisher.js';

export class InMemoryEventPublisher extends EventBus implements EventPublisher {}
