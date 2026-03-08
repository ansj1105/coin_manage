import { MockTronClient } from '../../infra/mock-tron-client.js';
import type { TronGateway } from '../../application/ports/tron-gateway.js';

export class MockTronGateway extends MockTronClient implements TronGateway {}
