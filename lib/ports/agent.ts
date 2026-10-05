/** Starts conversations with an ElevenLabs agent without exposing the API key to the browser. */
export interface AgentSessionProvider {
  /** A short-lived signed WebSocket URL for the (private) agent. */
  createSignedUrl(): Promise<string>;
}
