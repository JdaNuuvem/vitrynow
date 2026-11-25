export type Unsubscribe = () => void;
export type RealtimeEvent = { type: string; tableId?: string; ingredientId?: string; kind?: string };

export interface RealtimeGateway {
  subscribe(onEvent: (event?: RealtimeEvent) => void): Unsubscribe;
}
