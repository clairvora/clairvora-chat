// Environment bindings
export interface Env {
  CHAT_ROOM: DurableObjectNamespace;
  ENVIRONMENT: string;
  JWT_SECRET?: string;
  CHAT_API_KEY?: string;
  PHP_API_URL?: string;
}

// WebSocket message types
export type MessageType =
  | "auth"
  | "auth_success"
  | "auth_error"
  | "message"
  | "typing"
  | "presence"
  | "ping"
  | "pong"
  | "error"
  | "history";

export interface BaseMessage {
  type: MessageType;
}

export interface AuthMessage extends BaseMessage {
  type: "auth";
  token: string;
  userName: string;
}

export interface ChatMessage extends BaseMessage {
  type: "message";
  id: string;
  content: string;
  userId: string;
  userType: "client" | "advisor";
  userName: string;
  timestamp: number;
}

export interface TypingMessage extends BaseMessage {
  type: "typing";
  userId: string;
  userType: "client" | "advisor";
  isTyping: boolean;
}

export interface PresenceMessage extends BaseMessage {
  type: "presence";
  userId: string;
  userType: "client" | "advisor";
  userName: string;
  status: "online" | "offline";
}

// Session data stored with WebSocket
export interface SessionData {
  userId: string;
  userType: "client" | "advisor";
  userName: string;
  authenticated: boolean;
}
