import * as jose from "jose";

export interface TokenPayload {
  iss: string; // Issuer (clairvora.com)
  sub: string; // Subject (user_id)
  iat: number; // Issued at
  exp: number; // Expiry
  jti: string; // Unique token ID

  // Custom claims
  reading_id: string;
  user_type: "client" | "advisor";
  user_name: string;
  client_id: string;
  advisor_id: string;
  rate_per_minute: number;

  // Avatar URLs
  client_avatar: string;
  advisor_avatar: string;

  // Balance info
  client_balance: number;
  auto_refill_enabled: boolean;
}

export async function validateToken(
  token: string,
  jwtSecret: string
): Promise<TokenPayload | null> {
  try {
    const secret = new TextEncoder().encode(jwtSecret);

    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: "clairvora.com",
    });

    // Validate required fields
    if (
      !payload.sub ||
      !payload.reading_id ||
      !payload.user_type ||
      !payload.user_name
    ) {
      console.error("Token missing required fields");
      return null;
    }

    return payload as unknown as TokenPayload;
  } catch (error) {
    console.error("Token validation failed:", error);
    return null;
  }
}
