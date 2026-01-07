import { DurableObject } from "cloudflare:workers";
import type { Env, SessionData, ChatMessage, TypingMessage, PresenceMessage } from "../lib/types";
import { validateToken, type TokenPayload } from "../lib/auth";
import { PhpApiClient } from "../lib/php-api";

interface StoredMessage {
  id: string;
  user_id: string;
  user_type: string;
  user_name: string;
  content: string;
  timestamp: number;
}

export class ChatRoom extends DurableObject<Env> {
  private sessions: Map<WebSocket, SessionData> = new Map();
  private roomId: string | null = null;
  private phpApi: PhpApiClient;
  private tokenPayload: TokenPayload | null = null; // Store token data for API calls

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Initialize PHP API client
    this.phpApi = new PhpApiClient(env);

    // Restore sessions after hibernation
    this.ctx.getWebSockets().forEach((ws) => {
      const attachment = ws.deserializeAttachment() as SessionData | null;
      if (attachment) {
        this.sessions.set(ws, attachment);
      }
    });

    // Initialize SQLite schema
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          user_type TEXT NOT NULL,
          user_name TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        )
      `);

      // Also store room metadata
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Extract room ID from query param if provided
    const roomIdParam = url.searchParams.get("room_id");
    if (roomIdParam) {
      this.roomId = roomIdParam;
    }

    // WebSocket upgrade
    if (url.pathname === "/websocket") {
      return this.handleWebSocketUpgrade(request);
    }

    // Get message history
    if (url.pathname === "/history") {
      const messages = this.getRecentMessages(100);
      return new Response(JSON.stringify(messages), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  private handleWebSocketUpgrade(request: Request): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept with Hibernation API for cost efficiency
    this.ctx.acceptWebSocket(server);

    // Initialize session as unauthenticated
    const session: SessionData = {
      userId: "",
      userType: "client",
      userName: "Anonymous",
      authenticated: false,
    };
    server.serializeAttachment(session);
    this.sessions.set(server, session);

    return new Response(null, { status: 101, webSocket: client });
  }

  // Called when a WebSocket message is received
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(message as string);
      const session = this.sessions.get(ws);

      if (!session) {
        ws.send(JSON.stringify({ type: "error", message: "No session" }));
        return;
      }

      switch (data.type) {
        case "auth":
          await this.handleAuth(ws, session, data);
          break;

        case "message":
          if (!session.authenticated) {
            ws.send(JSON.stringify({ type: "error", message: "Not authenticated" }));
            return;
          }
          await this.handleChatMessage(ws, session, data);
          break;

        case "typing":
          if (!session.authenticated) return;
          this.handleTypingIndicator(ws, session, data);
          break;

        case "end_chat":
          if (!session.authenticated) {
            ws.send(JSON.stringify({ type: "error", message: "Not authenticated" }));
            return;
          }
          await this.handleEndChat(ws, session, data);
          break;

        case "ping":
          ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
          break;

        default:
          ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
      }
    } catch (error) {
      console.error("Message handling error:", error);
      ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
    }
  }

  // Called when a WebSocket connection is closed
  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const session = this.sessions.get(ws);

    if (session?.authenticated) {
      // Broadcast user left
      const presenceMsg: PresenceMessage = {
        type: "presence",
        userId: session.userId,
        userType: session.userType,
        userName: session.userName,
        status: "offline",
      };
      this.broadcast(presenceMsg, ws);
    }

    this.sessions.delete(ws);
  }

  // Called when a WebSocket error occurs
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("WebSocket error:", error);
    this.sessions.delete(ws);
  }

  private async handleAuth(
    ws: WebSocket,
    session: SessionData,
    data: { token?: string; userId?: string; userType?: string; userName?: string }
  ): Promise<void> {
    let userId: string;
    let userType: "client" | "advisor";
    let userName: string;

    // Check if JWT token is provided
    if (data.token && this.env.JWT_SECRET) {
      // Validate JWT token
      const payload = await validateToken(data.token, this.env.JWT_SECRET);

      if (!payload) {
        ws.send(JSON.stringify({ type: "auth_error", message: "Invalid or expired token" }));
        ws.close(4001, "Unauthorized");
        return;
      }

      // Verify room ID matches token's reading_id
      if (this.roomId && payload.reading_id !== this.roomId) {
        ws.send(JSON.stringify({ type: "auth_error", message: "Token not valid for this room" }));
        ws.close(4003, "Forbidden");
        return;
      }

      // Use values from token
      userId = payload.sub;
      userType = payload.user_type;
      userName = payload.user_name;

      // Store token payload for API calls (contains client_id, advisor_id, etc.)
      this.tokenPayload = payload;
    } else if (this.env.ENVIRONMENT === "development" && !this.env.JWT_SECRET) {
      // Development mode: allow simple auth without JWT
      userId = data.userId || crypto.randomUUID();
      userType = data.userType === "advisor" ? "advisor" : "client";
      userName = data.userName || "Anonymous";
    } else {
      // Production mode: require JWT
      ws.send(JSON.stringify({ type: "auth_error", message: "Token required" }));
      ws.close(4001, "Unauthorized");
      return;
    }

    // Update session
    session.userId = userId;
    session.userType = userType;
    session.userName = userName;
    session.authenticated = true;

    // Persist for hibernation
    ws.serializeAttachment(session);
    this.sessions.set(ws, session);

    // Send auth success with current participants
    ws.send(
      JSON.stringify({
        type: "auth_success",
        userId: userId,
        participants: this.getParticipantList(),
      })
    );

    // Send message history
    const messages = this.getRecentMessages(100);
    ws.send(JSON.stringify({ type: "history", messages }));

    // Broadcast join to others
    const presenceMsg: PresenceMessage = {
      type: "presence",
      userId: userId,
      userType: userType,
      userName: userName,
      status: "online",
    };
    this.broadcast(presenceMsg, ws);
  }

  private async handleChatMessage(
    ws: WebSocket,
    session: SessionData,
    data: { content?: string }
  ): Promise<void> {
    if (!data.content || data.content.trim() === "") {
      return;
    }

    const message: ChatMessage = {
      type: "message",
      id: crypto.randomUUID(),
      content: this.sanitizeContent(data.content),
      userId: session.userId,
      userType: session.userType,
      userName: session.userName,
      timestamp: Date.now(),
    };

    // Store in SQLite (local cache)
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (id, user_id, user_type, user_name, content, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      message.id,
      message.userId,
      message.userType,
      message.userName,
      message.content,
      message.timestamp
    );

    // Broadcast to all participants (including sender for confirmation)
    this.broadcast(message);

    // Sync to PHP/MySQL in background (non-blocking)
    if (this.tokenPayload && this.roomId) {
      this.ctx.waitUntil(this.syncMessageToPhp(message));
    }
  }

  /**
   * Sync message to PHP backend (runs in background)
   */
  private async syncMessageToPhp(message: ChatMessage): Promise<void> {
    if (!this.tokenPayload || !this.roomId) {
      console.warn("Cannot sync message: missing token payload or room ID");
      return;
    }

    try {
      await this.phpApi.syncMessage({
        readingId: this.roomId,
        clientId: this.tokenPayload.client_id,
        advisorId: this.tokenPayload.advisor_id,
        userType: message.userType,
        message: message.content,
        messageId: message.id,
        timestamp: message.timestamp,
      });
    } catch (error) {
      console.error("Failed to sync message to PHP:", error);
      // Message is still stored locally, can be synced later if needed
    }
  }

  /**
   * Handle end chat request - triggers billing and closes all connections
   */
  private async handleEndChat(
    ws: WebSocket,
    session: SessionData,
    data: { reason?: string }
  ): Promise<void> {
    if (!this.tokenPayload || !this.roomId) {
      ws.send(JSON.stringify({ type: "error", message: "Cannot end chat: missing session data" }));
      return;
    }

    const endedBy = session.userType;
    const reason = (data.reason as "normal" | "timeout" | "low_balance" | "disconnect") || "normal";

    try {
      // Call PHP to end reading and trigger billing
      const result = await this.phpApi.endReading({
        readingId: this.roomId,
        endedBy: endedBy,
        reason: reason,
      });

      // Broadcast chat ended to all participants
      const endMessage = {
        type: "chat_ended",
        endedBy: endedBy,
        userName: session.userName,
        reason: reason,
        billing: result.billing,
        timestamp: Date.now(),
      };
      this.broadcast(endMessage);

      // Send confirmation to the user who ended it
      ws.send(JSON.stringify({
        type: "end_chat_success",
        ...result,
      }));

      // Close all WebSocket connections after a short delay
      setTimeout(() => {
        for (const [socket] of this.sessions) {
          try {
            socket.close(1000, "Chat session ended");
          } catch (e) {
            // Socket already closed
          }
        }
        this.sessions.clear();
      }, 1000);

    } catch (error) {
      console.error("Failed to end chat:", error);
      ws.send(JSON.stringify({
        type: "error",
        message: "Failed to end chat. Please try again.",
      }));
    }
  }

  private handleTypingIndicator(
    ws: WebSocket,
    session: SessionData,
    data: { isTyping?: boolean }
  ): void {
    const typingMsg: TypingMessage = {
      type: "typing",
      userId: session.userId,
      userType: session.userType,
      isTyping: data.isTyping ?? false,
    };

    // Broadcast to others only
    this.broadcast(typingMsg, ws);
  }

  private broadcast(message: object, exclude?: WebSocket): void {
    const payload = JSON.stringify(message);

    for (const [ws, session] of this.sessions) {
      if (ws === exclude) continue;
      if (!session.authenticated) continue;

      try {
        ws.send(payload);
      } catch (e) {
        // Connection broken, will be cleaned up on close event
      }
    }
  }

  private getParticipantList(): { userId: string; userType: string; userName: string }[] {
    const participants: { userId: string; userType: string; userName: string }[] = [];

    for (const [, session] of this.sessions) {
      if (session.authenticated) {
        participants.push({
          userId: session.userId,
          userType: session.userType,
          userName: session.userName,
        });
      }
    }

    return participants;
  }

  private getRecentMessages(limit: number): StoredMessage[] {
    const cursor = this.ctx.storage.sql.exec(
      `SELECT id, user_id, user_type, user_name, content, timestamp
       FROM messages
       ORDER BY timestamp DESC
       LIMIT ?`,
      limit
    );

    const messages: StoredMessage[] = [];
    for (const row of cursor) {
      messages.push({
        id: row.id as string,
        user_id: row.user_id as string,
        user_type: row.user_type as string,
        user_name: row.user_name as string,
        content: row.content as string,
        timestamp: row.timestamp as number,
      });
    }

    // Return in chronological order
    return messages.reverse();
  }

  private sanitizeContent(content: string): string {
    // Basic XSS prevention - encode HTML entities
    return content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;")
      .substring(0, 1000); // Limit length
  }
}
