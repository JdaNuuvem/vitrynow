export type Unsubscribe = () => void;

export interface RealtimeGateway {
  subscribe(onEvent: () => void): Unsubscribe;
}
