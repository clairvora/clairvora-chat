/**
 * PHP API Client for Cloudflare Chat Worker
 *
 * Handles communication with the clairvora.com PHP backend for:
 * - Balance checking
 * - Message syncing
 * - Reading end/billing
 */

import type { Env } from "./types";

export interface BalanceResponse {
  success: boolean;
  reading_id: number;
  reading_status: number;
  client_id: number;
  balance: number;
  rate_per_minute: number;
  minutes_remaining: number;
  auto_refill_enabled: boolean;
  backup_payments_enabled: boolean;
}

export interface SyncMessageResponse {
  success: boolean;
  chat_id?: number;
  message_id?: string;
  duplicate?: boolean;
  error?: string;
}

export interface EndReadingResponse {
  success: boolean;
  reading_id: number;
  ended_by: string;
  reason: string;
  already_ended?: boolean;
  billing?: {
    charged: boolean;
    duration_minutes: number;
    amount: number;
    advisor_commission: number;
  };
  error?: string;
}

export class PhpApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(env: Env) {
    this.baseUrl = env.PHP_API_URL || "https://clairvora.com/api/chat";
    this.apiKey = env.CHAT_API_KEY || "";
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/${endpoint}`;

    const headers: Record<string, string> = {
      "X-Chat-API-Key": this.apiKey,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = (await response.json()) as T & { error?: string };

    if (!response.ok) {
      console.error(`PHP API error: ${url}`, data);
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    return data;
  }

  /**
   * Get client balance and refill settings for a reading
   */
  async getBalance(readingId: string): Promise<BalanceResponse> {
    return this.request<BalanceResponse>(
      `balance.php?reading_id=${readingId}`
    );
  }

  /**
   * Sync a message to the PHP/MySQL database
   */
  async syncMessage(params: {
    readingId: string;
    clientId: string;
    advisorId: string;
    userType: "client" | "advisor";
    message: string;
    messageId: string;
    timestamp: number;
  }): Promise<SyncMessageResponse> {
    return this.request<SyncMessageResponse>("sync-message.php", {
      method: "POST",
      body: JSON.stringify({
        reading_id: params.readingId,
        client_id: params.clientId,
        advisor_id: params.advisorId,
        user_type: params.userType,
        message: params.message,
        message_id: params.messageId,
        timestamp: params.timestamp,
      }),
    });
  }

  /**
   * End a reading and trigger billing
   */
  async endReading(params: {
    readingId: string;
    endedBy: "client" | "advisor" | "system";
    reason: "normal" | "timeout" | "low_balance" | "disconnect";
  }): Promise<EndReadingResponse> {
    return this.request<EndReadingResponse>("end-reading.php", {
      method: "POST",
      body: JSON.stringify({
        reading_id: params.readingId,
        ended_by: params.endedBy,
        reason: params.reason,
      }),
    });
  }
}
