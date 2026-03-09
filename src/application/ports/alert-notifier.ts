export interface AlertNotifier {
  sendMessage(input: { title: string; body: string; dedupeKey?: string }): Promise<void>;
}
