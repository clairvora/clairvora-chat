import { ChatRoom } from "./durable-objects/ChatRoom";
import type { Env } from "./lib/types";

// Export the Durable Object class
export { ChatRoom };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers for cross-origin requests from clairvora.com
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*", // TODO: Restrict to clairvora.com in production
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === "/health") {
      return new Response("OK", {
        status: 200,
        headers: corsHeaders,
      });
    }

    // WebSocket route: /chat/{room_id}
    // room_id will be the reading_id in production
    const chatMatch = url.pathname.match(/^\/chat\/([^/]+)$/);
    if (chatMatch) {
      const roomId = chatMatch[1];

      if (!roomId) {
        return new Response("Missing room ID", {
          status: 400,
          headers: corsHeaders,
        });
      }

      // Get Durable Object stub by room ID (deterministic)
      const id = env.CHAT_ROOM.idFromName(roomId);
      const stub = env.CHAT_ROOM.get(id);

      // Forward request to Durable Object
      // Rewrite URL to /websocket for the DO, pass room_id as query param
      const doUrl = new URL(request.url);
      doUrl.pathname = "/websocket";
      doUrl.searchParams.set("room_id", roomId);

      return stub.fetch(new Request(doUrl, request));
    }

    // API route: Get chat history
    // GET /api/chat/{room_id}/history
    const historyMatch = url.pathname.match(/^\/api\/chat\/([^/]+)\/history$/);
    if (historyMatch && request.method === "GET") {
      const roomId = historyMatch[1];

      const id = env.CHAT_ROOM.idFromName(roomId);
      const stub = env.CHAT_ROOM.get(id);

      const response = await stub.fetch(new Request(`${url.origin}/history`));
      const body = await response.text();

      return new Response(body, {
        status: response.status,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      });
    }

    // Not found
    return new Response("Not found", {
      status: 404,
      headers: corsHeaders,
    });
  },
};
