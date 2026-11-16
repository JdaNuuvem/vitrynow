import { API_URL } from "@/lib/api";
import type { RealtimeGateway, Unsubscribe } from "../RealtimeGateway";

export class WebSocketRealtimeGateway implements RealtimeGateway {
  subscribe(onEvent: () => void): Unsubscribe {
    const socket = new WebSocket(`${API_URL.replace(/^http/, "ws")}/ws/panel`);
    socket.onmessage = () => onEvent();
    return () => socket.close();
  }
}
