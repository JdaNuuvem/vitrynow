import { API_URL } from "@/lib/api";
import type { RealtimeEvent, RealtimeGateway, Unsubscribe } from "../RealtimeGateway";

export class WebSocketRealtimeGateway implements RealtimeGateway {
  subscribe(onEvent: (event?: RealtimeEvent) => void): Unsubscribe {
    const socket = new WebSocket(`${API_URL.replace(/^http/, "ws")}/ws/panel`);
    socket.onmessage = ({ data }) => {
      let event: RealtimeEvent | undefined;
      try { event = JSON.parse(data); } catch { /* Still tell listeners that a message arrived. */ }
      onEvent(event);
    };
    return () => socket.close();
  }
}
