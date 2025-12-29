/**
 * ============================================================================
 * DOME WEBSOCKET CLIENT - REAL-TIME ORDER STREAM
 * ============================================================================
 *
 * WebSocket connector for receiving real-time Polymarket order updates.
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Subscription management by wallet addresses
 * - Event emitter pattern for order updates
 *
 * ENVIRONMENT VARIABLES:
 * - DOME_API_KEY: Required. Dome API bearer token.
 *
 * USAGE:
 *   import { domeWsClient } from '@/lib/dome/wsClient';
 *   domeWsClient.connect();
 *   domeWsClient.subscribe(['0x123...', '0x456...']);
 *   domeWsClient.onOrder((order) => console.log(order));
 *
 * Terminal: Claude 2 (Strategy Builder Data Layer)
 * Date: 2025-12-07
 */

import type { DomeOrder } from './client';

// ============================================================================
// Types
// ============================================================================

export type DomeWsStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface DomeWsSubscription {
  id: string;
  users: string[];
  createdAt: number;
}

export interface DomeWsMessage {
  type: 'ack' | 'event' | 'error';
  subscription_id?: string;
  data?: DomeOrder;
  error?: string;
}

export type OrderHandler = (order: DomeOrder) => void;
export type StatusHandler = (status: DomeWsStatus) => void;
export type ErrorHandler = (error: string) => void;

// ============================================================================
// Configuration
// ============================================================================

const WS_BASE_URL = 'wss://ws.domeapi.io';
const RECONNECT_BASE_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;

// ============================================================================
// WebSocket Client Class
// ============================================================================

class DomeWsClient {
  private ws: WebSocket | null = null;
  private status: DomeWsStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private subscriptions: Map<string, DomeWsSubscription> = new Map();
  private pendingSubscription: string[] | null = null;

  // Event handlers
  private orderHandlers: Set<OrderHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  private errorHandlers: Set<ErrorHandler> = new Set();

  /**
   * Connect to the Dome WebSocket server
   */
  connect(): void {
    if (this.status === 'connected' || this.status === 'connecting') {
      return;
    }

    const apiKey = process.env.DOME_API_KEY;
    if (!apiKey) {
      this.emitError('DOME_API_KEY environment variable not set');
      return;
    }

    this.setStatus('connecting');

    try {
      this.ws = new WebSocket(`${WS_BASE_URL}/${apiKey}`);

      this.ws.onopen = () => {
        console.log('[DomeWS] Connected');
        this.setStatus('connected');
        this.reconnectAttempts = 0;

        // Re-subscribe if we had pending subscriptions
        if (this.pendingSubscription) {
          this.subscribe(this.pendingSubscription);
          this.pendingSubscription = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as DomeWsMessage;
          this.handleMessage(message);
        } catch (error) {
          console.error('[DomeWS] Failed to parse message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[DomeWS] WebSocket error:', error);
        this.emitError('WebSocket connection error');
      };

      this.ws.onclose = (event) => {
        console.log('[DomeWS] Connection closed:', event.code, event.reason);
        this.ws = null;
        this.setStatus('disconnected');
        this.attemptReconnect();
      };
    } catch (error: any) {
      console.error('[DomeWS] Failed to create WebSocket:', error);
      this.emitError(error.message);
      this.setStatus('disconnected');
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.subscriptions.clear();
    this.setStatus('disconnected');
    console.log('[DomeWS] Disconnected');
  }

  /**
   * Subscribe to order updates for specific wallet addresses
   */
  subscribe(users: string[]): void {
    if (this.status !== 'connected' || !this.ws) {
      // Save for later when connected
      this.pendingSubscription = users;
      return;
    }

    const message = {
      action: 'subscribe',
      platform: 'polymarket',
      version: 1,
      type: 'orders',
      filters: {
        users: users.map(u => u.toLowerCase()),
      },
    };

    this.ws.send(JSON.stringify(message));
    console.log('[DomeWS] Subscription request sent for', users.length, 'wallets');
  }

  /**
   * Unsubscribe from a specific subscription
   */
  unsubscribe(subscriptionId: string): void {
    if (this.status !== 'connected' || !this.ws) {
      return;
    }

    const message = {
      action: 'unsubscribe',
      subscription_id: subscriptionId,
    };

    this.ws.send(JSON.stringify(message));
    this.subscriptions.delete(subscriptionId);
    console.log('[DomeWS] Unsubscribed from', subscriptionId);
  }

  /**
   * Get current connection status
   */
  getStatus(): DomeWsStatus {
    return this.status;
  }

  /**
   * Get active subscriptions
   */
  getSubscriptions(): DomeWsSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Register a handler for order events
   */
  onOrder(handler: OrderHandler): () => void {
    this.orderHandlers.add(handler);
    return () => this.orderHandlers.delete(handler);
  }

  /**
   * Register a handler for status changes
   */
  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  /**
   * Register a handler for errors
   */
  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private handleMessage(message: DomeWsMessage): void {
    switch (message.type) {
      case 'ack':
        if (message.subscription_id) {
          console.log('[DomeWS] Subscription acknowledged:', message.subscription_id);
          this.subscriptions.set(message.subscription_id, {
            id: message.subscription_id,
            users: this.pendingSubscription || [],
            createdAt: Date.now(),
          });
        }
        break;

      case 'event':
        if (message.data) {
          this.emitOrder(message.data);
        }
        break;

      case 'error':
        console.error('[DomeWS] Server error:', message.error);
        this.emitError(message.error || 'Unknown server error');
        break;

      default:
        console.warn('[DomeWS] Unknown message type:', message);
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[DomeWS] Max reconnect attempts reached');
      this.emitError('Max reconnect attempts reached');
      return;
    }

    // Save current subscriptions for re-subscription
    if (this.subscriptions.size > 0) {
      const allUsers = Array.from(this.subscriptions.values())
        .flatMap(sub => sub.users);
      this.pendingSubscription = Array.from(new Set(allUsers));
    }

    this.setStatus('reconnecting');
    this.reconnectAttempts++;

    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY_MS
    );

    console.log(`[DomeWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private setStatus(status: DomeWsStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.statusHandlers.forEach(handler => handler(status));
    }
  }

  private emitOrder(order: DomeOrder): void {
    this.orderHandlers.forEach(handler => handler(order));
  }

  private emitError(error: string): void {
    this.errorHandlers.forEach(handler => handler(error));
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const domeWsClient = new DomeWsClient();

// ============================================================================
// React Hook (for client-side use)
// ============================================================================

// Note: This would be used in a separate hooks file for React components
// Left as a comment for documentation purposes:
//
// export function useDomeWsOrders(wallets: string[]) {
//   const [orders, setOrders] = useState<DomeOrder[]>([]);
//   const [status, setStatus] = useState<DomeWsStatus>('disconnected');
//
//   useEffect(() => {
//     const unsubOrder = domeWsClient.onOrder((order) => {
//       setOrders(prev => [order, ...prev].slice(0, 100));
//     });
//     const unsubStatus = domeWsClient.onStatusChange(setStatus);
//
//     domeWsClient.connect();
//     if (wallets.length > 0) {
//       domeWsClient.subscribe(wallets);
//     }
//
//     return () => {
//       unsubOrder();
//       unsubStatus();
//     };
//   }, [wallets.join(',')]);
//
//   return { orders, status };
// }
