# CLAUDE.md - Clairvora Chat Service

## Project Overview

Real-time WebSocket chat service for Clairvora psychic readings. Built on Cloudflare Durable Objects for persistent WebSocket connections.

## Tech Stack

- **Runtime:** Cloudflare Workers
- **Real-time:** Durable Objects (WebSocket)
- **Database:** Cloudflare D1 (shared with main app)
- **Auth:** Clerk (validates tokens from main app)
- **Language:** TypeScript

## What This Service Does

- Manages WebSocket connections for chat readings
- Handles real-time message delivery
- Tracks typing indicators
- Stores chat history in D1
- Updates reading status and balance during chat

## Related Services

| Service | Repo | Purpose |
|---------|------|---------|
| Main App | `clairvora` | UI, payments, user accounts |
| Phone | `clairvora-phone` | Voice/video calls |
| Admin | `clairvora-admin` | Admin dashboard |

## Reference Code

Legacy PHP chat implementation at `/Users/softdev/Sites/clairvora-legacy/`:
- `httpdocs/psychics/readings/chat/` - Chat reading flow
- `httpdocs/api/chat/` - Chat API endpoints
- `_includes/functions_READINGS.php` - Reading management

## Project Structure

```
src/
├── index.ts                    # Worker entry point, routing
├── durable-objects/
│   └── ChatRoom.ts             # Durable Object for chat rooms
└── lib/
    ├── types.ts                # TypeScript types
    └── auth.ts                 # Clerk token validation
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/chat/{room_id}` | WebSocket | Connect to chat room |
| `/api/chat/{room_id}/history` | GET | Get message history |
| `/health` | GET | Health check |

## WebSocket Messages

**Client → Server:**
```json
{"type": "message", "content": "Hello"}
{"type": "typing", "isTyping": true}
```

**Server → Client:**
```json
{"type": "message", "from": "client", "content": "Hello", "timestamp": "..."}
{"type": "typing", "from": "advisor", "isTyping": true}
{"type": "status", "reading_status": "active"}
```

## Commands

```bash
npm run dev      # Start local dev server
npm run deploy   # Deploy to Cloudflare
```

## Environment Variables

Set via `wrangler secret put`:
- `CLERK_SECRET_KEY` - Validate auth tokens

D1 binding configured in `wrangler.jsonc`.
