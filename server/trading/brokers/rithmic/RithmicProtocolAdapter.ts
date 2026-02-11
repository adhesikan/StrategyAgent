import { EventEmitter } from "events";
import WebSocket from "ws";
import type {
  IFuturesBrokerAdapter,
  FuturesTick,
  FuturesBar,
  FuturesOrderRequest,
  FuturesOrderUpdate,
  FuturesAdapterEvents,
} from "../futures/types";
import { loadProtoRoot, validateProtos, decode } from "./codec";
import { packMessage, peekTemplateIdFast } from "./frame";
import {
  normalizeLastTrade,
  normalizeBbo,
  normalizeTimeBar,
  normalizeOrderNotification,
  normalizePositionUpdate,
} from "./normalize";
import templateIds from "./templateIds.json";

interface RithmicConfig {
  tickerPlantUri: string;
  orderPlantUri: string;
  systemName: string;
  userId: string;
  password: string;
  appName?: string;
  appVersion?: string;
  fcmId?: string;
  ibId?: string;
  accountId?: string;
}

type PlantType = "ticker" | "order";

interface PlantConnection {
  ws: WebSocket | null;
  uri: string;
  infraType: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
}

export class RithmicProtocolAdapter extends EventEmitter implements IFuturesBrokerAdapter {
  private config: RithmicConfig;
  private plants = new Map<PlantType, PlantConnection>();
  private subscribedSymbols = new Set<string>();
  private _connected = false;
  private _dataOnly = false;
  private orderCounter = 0;
  private pendingOrderMap = new Map<string, { resolve: (id: string) => void; reject: (err: Error) => void }>();
  private tickState = new Map<string, Partial<FuturesTick>>();

  constructor(config: RithmicConfig) {
    super();
    this.config = config;

    this.plants.set("ticker", {
      ws: null,
      uri: config.tickerPlantUri,
      infraType: 1,
      heartbeatTimer: null,
    });

    this.plants.set("order", {
      ws: null,
      uri: config.orderPlantUri,
      infraType: 2,
      heartbeatTimer: null,
    });
  }

  async connect(): Promise<void> {
    const validation = await validateProtos();
    if (!validation.valid) {
      throw new Error(`[Rithmic] Proto validation failed: ${validation.errors.join(", ")}`);
    }

    await loadProtoRoot();

    const gatewayUri = this.config.tickerPlantUri;
    if (gatewayUri) {
      try {
        const discovered = await this.discoverGateways(gatewayUri);
        if (discovered) {
          const tickerPlant = this.plants.get("ticker")!;
          const orderPlant = this.plants.get("order")!;
          if (discovered.ticker) {
            tickerPlant.uri = discovered.ticker;
            console.log(`[Rithmic] Discovered ticker URI: ${discovered.ticker}`);
          }
          if (discovered.order) {
            orderPlant.uri = discovered.order;
            console.log(`[Rithmic] Discovered order URI: ${discovered.order}`);
          }
        }
      } catch (err) {
        console.warn(`[Rithmic] Gateway discovery failed, using configured URIs: ${err instanceof Error ? err.message : err}`);
      }
    }

    await this.connectPlant("ticker");

    try {
      await this.connectPlant("order");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Rithmic] Order plant connection failed: ${msg}`);
      console.warn("[Rithmic] Running in data-only mode (market data available, trading disabled)");
      this._dataOnly = true;
    }

    this._connected = true;
    this.emit("status", "connected");
    console.log(`[Rithmic] Connected${this._dataOnly ? " (data-only mode)" : " to all plants"}`);
  }

  private async discoverGateways(gatewayUri: string): Promise<{ ticker?: string; order?: string } | null> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(gatewayUri, { perMessageDeflate: false });
      ws.binaryType = "nodebuffer";

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Gateway discovery timeout"));
      }, 10000);

      ws.on("open", () => {
        const buf = packMessage("RequestRithmicSystemGatewayInfo", {
          templateId: templateIds.RequestRithmicSystemGatewayInfo,
          systemName: this.config.systemName,
        });
        ws.send(buf);
      });

      const uris: { ticker?: string; order?: string } = {};
      let receivedCount = 0;

      ws.on("message", (data: Buffer) => {
        const msgBuf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const tid = peekTemplateIdFast(msgBuf);

        if (tid === templateIds.ResponseRithmicSystemGatewayInfo) {
          try {
            const resp = decode("ResponseRithmicSystemGatewayInfo", msgBuf) as Record<string, unknown>;
            const names = resp.gatewayName as string[] | undefined;
            const gatewayUris = resp.gatewayUri as string[] | undefined;

            console.log(`[Rithmic] Gateway info: names=${JSON.stringify(names)}, uris=${JSON.stringify(gatewayUris)}`);

            if (names && gatewayUris) {
              for (let i = 0; i < names.length; i++) {
                const name = names[i]?.toLowerCase() ?? "";
                const uri = gatewayUris[i];
                if (!uri) continue;
                if (name.includes("ticker")) uris.ticker = uri;
                else if (name.includes("order")) uris.order = uri;
              }
            }

            receivedCount++;
            if (receivedCount >= 1) {
              clearTimeout(timeout);
              ws.close();
              if (uris.ticker || uris.order) {
                resolve(uris);
              } else {
                resolve(null);
              }
            }
          } catch (err) {
            clearTimeout(timeout);
            ws.close();
            reject(err);
          }
        }
      });

      ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  async disconnect(): Promise<void> {
    const plantTypes: PlantType[] = ["ticker", "order"];
    for (const type of plantTypes) {
      const plant = this.plants.get(type);
      if (!plant) continue;
      if (plant.heartbeatTimer) {
        clearInterval(plant.heartbeatTimer);
        plant.heartbeatTimer = null;
      }
      if (plant.ws && plant.ws.readyState === WebSocket.OPEN) {
        try {
          const logoutBuf = packMessage("RequestLogout", {
            templateId: templateIds.RequestLogout,
            userMsg: ["goodbye"],
          });
          plant.ws.send(logoutBuf);
        } catch {}
        plant.ws.close();
      }
      plant.ws = null;
    }
    this.subscribedSymbols.clear();
    this._connected = false;
    this.emit("status", "disconnected");
  }

  isConnected(): boolean {
    return this._connected;
  }

  isDataOnly(): boolean {
    return this._dataOnly;
  }

  getSubscribedSymbols(): string[] {
    return Array.from(this.subscribedSymbols);
  }

  async subscribeMarketData(symbol: string): Promise<void> {
    if (this.subscribedSymbols.has(symbol)) return;

    const plant = this.plants.get("ticker");
    if (!plant?.ws || plant.ws.readyState !== WebSocket.OPEN) {
      throw new Error("[Rithmic] Ticker plant not connected");
    }

    const rithmicSymbol = this.toRithmicSymbol(symbol);

    const mdBuf = packMessage("RequestMarketDataUpdate", {
      templateId: templateIds.RequestMarketDataUpdate,
      symbol: rithmicSymbol,
      exchange: "CME",
      requestType: 1,
      updateBits: 1 | 2 | 4,
    });
    plant.ws.send(mdBuf);

    const barBuf = packMessage("RequestTimeBarUpdate", {
      templateId: templateIds.RequestTimeBarUpdate,
      symbol: rithmicSymbol,
      exchange: "CME",
      requestType: 1,
      barType: 1,
      barSubType: 1,
    });
    plant.ws.send(barBuf);

    this.subscribedSymbols.add(symbol);
    console.log(`[Rithmic] Subscribed to market data: ${symbol} (${rithmicSymbol})`);
  }

  async unsubscribeMarketData(symbol: string): Promise<void> {
    if (!this.subscribedSymbols.has(symbol)) return;

    const plant = this.plants.get("ticker");
    if (plant?.ws && plant.ws.readyState === WebSocket.OPEN) {
      const rithmicSymbol = this.toRithmicSymbol(symbol);
      const buf = packMessage("RequestMarketDataUpdate", {
        templateId: templateIds.RequestMarketDataUpdate,
        symbol: rithmicSymbol,
        exchange: "CME",
        requestType: 2,
      });
      plant.ws.send(buf);
    }

    this.subscribedSymbols.delete(symbol);
  }

  async placeOrder(req: FuturesOrderRequest): Promise<{ brokerOrderId: string }> {
    if (this._dataOnly) {
      throw new Error("[Rithmic] Trading is not available - running in data-only mode (order plant not connected)");
    }
    const plant = this.plants.get("order");
    if (!plant?.ws || plant.ws.readyState !== WebSocket.OPEN) {
      throw new Error("[Rithmic] Order plant not connected");
    }

    const userTag = `VCP-${++this.orderCounter}-${Date.now()}`;
    const rithmicSymbol = this.toRithmicSymbol(req.symbol);

    let priceType = 2;
    const payload: Record<string, unknown> = {
      templateId: templateIds.RequestNewOrder,
      symbol: rithmicSymbol,
      exchange: "CME",
      transactionType: req.side === "buy" ? 1 : 2,
      quantity: req.qty,
      duration: 1,
      priceType,
      userMsg: [userTag],
      orderPlacement: 2,
    };

    if (req.orderType === "limit") {
      payload.priceType = 1;
      payload.price = req.limitPrice;
    } else if (req.orderType === "stop") {
      payload.priceType = 4;
      payload.triggerPrice = req.stopPrice;
    }

    if (this.config.accountId) {
      payload.accountId = this.config.accountId;
    }
    if (this.config.fcmId) {
      payload.fcmId = this.config.fcmId;
    }
    if (this.config.ibId) {
      payload.ibId = this.config.ibId;
    }

    return new Promise((resolve, reject) => {
      this.pendingOrderMap.set(userTag, { resolve: (id) => resolve({ brokerOrderId: id }), reject });

      const buf = packMessage("RequestNewOrder", payload);
      plant.ws!.send(buf);

      setTimeout(() => {
        if (this.pendingOrderMap.has(userTag)) {
          this.pendingOrderMap.delete(userTag);
          reject(new Error(`[Rithmic] Order timeout for ${userTag}`));
        }
      }, 15000);
    });
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    const plant = this.plants.get("order");
    if (!plant?.ws || plant.ws.readyState !== WebSocket.OPEN) {
      throw new Error("[Rithmic] Order plant not connected");
    }

    const buf = packMessage("RequestCancelOrder", {
      templateId: templateIds.RequestCancelOrder,
      basketId: brokerOrderId,
      userMsg: ["cancel"],
    });
    plant.ws.send(buf);
  }

  private async connectPlant(type: PlantType): Promise<void> {
    const plant = this.plants.get(type)!;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(plant.uri, {
        perMessageDeflate: false,
      });

      ws.binaryType = "nodebuffer";

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`[Rithmic] ${type} plant connection timeout`));
      }, 15000);

      ws.on("open", async () => {
        clearTimeout(timeout);
        plant.ws = ws;

        try {
          await this.loginPlant(type);
          plant.heartbeatTimer = setInterval(() => this.sendHeartbeat(type), 30000);

          if (type === "order") {
            this.subscribeOrderUpdates();
          }

          resolve();
        } catch (err) {
          reject(err);
        }
      });

      ws.on("message", (data: Buffer) => {
        this.handleMessage(type, data);
      });

      ws.on("close", () => {
        console.log(`[Rithmic] ${type} plant disconnected`);
        if (this._connected) {
          this._connected = false;
          this.emit("status", "disconnected");
        }
      });

      ws.on("error", (err) => {
        console.error(`[Rithmic] ${type} plant error:`, err.message);
        clearTimeout(timeout);
      });
    });
  }

  private async loginPlant(type: PlantType): Promise<void> {
    const plant = this.plants.get(type)!;
    if (!plant.ws) throw new Error("No websocket");

    const buf = packMessage("RequestLogin", {
      templateId: templateIds.RequestLogin,
      templateVersion: "3.9",
      user: this.config.userId,
      password: this.config.password,
      appName: this.config.appName ?? "VCPTrader",
      appVersion: this.config.appVersion ?? "1.0.0",
      systemName: this.config.systemName,
      infraType: plant.infraType,
    });

    return new Promise((resolve, reject) => {
      const loginTimeout = setTimeout(() => reject(new Error(`[Rithmic] Login timeout for ${type}`)), 10000);

      const originalHandler = (data: Buffer) => {
        const msgBuf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const tid = peekTemplateIdFast(msgBuf);
        if (tid === templateIds.ResponseLogin) {
          clearTimeout(loginTimeout);
          plant.ws!.removeListener("message", originalHandler);
          try {
            const resp = decode("ResponseLogin", msgBuf) as Record<string, unknown>;
            const rpCode = resp.rpCode as string[] | string | undefined;
            const codeStr = Array.isArray(rpCode) ? rpCode[0] : rpCode;
            const userMsg = resp.userMsg as string[] | string | undefined;
            const userMsgStr = Array.isArray(userMsg) ? userMsg.join("; ") : (userMsg ?? "");
            if (codeStr && codeStr !== "0") {
              console.error(`[Rithmic] Login rejected for ${type}: code=${codeStr}, msg="${userMsgStr}", fcmId=${resp.fcmId ?? "n/a"}, ibId=${resp.ibId ?? "n/a"}`);
              reject(new Error(`[Rithmic] Login failed for ${type}: code ${codeStr} - ${userMsgStr || "permission error"}`));
            } else {
              console.log(`[Rithmic] Logged into ${type} plant (fcmId=${resp.fcmId ?? "n/a"}, ibId=${resp.ibId ?? "n/a"})`);
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        }
      };

      plant.ws!.on("message", originalHandler);
      plant.ws!.send(buf);
    });
  }

  private sendHeartbeat(type: PlantType) {
    const plant = this.plants.get(type);
    if (!plant?.ws || plant.ws.readyState !== WebSocket.OPEN) return;

    const buf = packMessage("RequestHeartbeat", {
      templateId: templateIds.RequestHeartbeat,
    });
    plant.ws.send(buf);
  }

  private subscribeOrderUpdates() {
    const plant = this.plants.get("order");
    if (!plant?.ws) return;

    const buf = packMessage("RequestSubscribeForOrderUpdates", {
      templateId: templateIds.RequestSubscribeForOrderUpdates,
    });
    plant.ws.send(buf);
  }

  private handleMessage(type: PlantType, raw: Buffer) {
    const tid = peekTemplateIdFast(raw);
    if (tid === null) return;

    try {
      this.dispatch(tid, raw);
    } catch (err) {
      console.error(`[Rithmic] Error dispatching template ${tid}:`, err);
    }
  }

  private dispatch(tid: number, msgBuf: Buffer) {
    switch (tid) {
      case templateIds.ResponseHeartbeat:
        break;

      case templateIds.LastTrade: {
        const data = decode("LastTrade", msgBuf) as Record<string, unknown>;
        const partial = normalizeLastTrade(data);
        if (partial && partial.symbol) {
          const existing = this.tickState.get(partial.symbol) ?? {};
          const merged: FuturesTick = {
            symbol: partial.symbol,
            price: partial.price ?? existing.price ?? 0,
            bid: existing.bid ?? 0,
            ask: existing.ask ?? 0,
            volume: partial.volume ?? existing.volume ?? 0,
            timestamp: partial.timestamp ?? Date.now(),
          };
          this.tickState.set(partial.symbol, merged);
          this.emit("tick", merged);
        }
        break;
      }

      case templateIds.BestBidOffer: {
        const data = decode("BestBidOffer", msgBuf) as Record<string, unknown>;
        const partial = normalizeBbo(data);
        if (partial && partial.symbol) {
          const existing = this.tickState.get(partial.symbol) ?? {};
          const merged: FuturesTick = {
            symbol: partial.symbol,
            price: existing.price ?? 0,
            bid: partial.bid ?? existing.bid ?? 0,
            ask: partial.ask ?? existing.ask ?? 0,
            volume: existing.volume ?? 0,
            timestamp: partial.timestamp ?? Date.now(),
          };
          this.tickState.set(partial.symbol, merged);
          this.emit("tick", merged);
        }
        break;
      }

      case templateIds.ResponseTimeBarUpdate: {
        const data = decode("ResponseTimeBarUpdate", msgBuf) as Record<string, unknown>;
        const bar = normalizeTimeBar(data);
        if (bar) {
          this.emit("bar", bar);
        }
        break;
      }

      case templateIds.RithmicOrderNotification: {
        const data = decode("RithmicOrderNotification", msgBuf) as Record<string, unknown>;
        const update = normalizeOrderNotification(data);
        if (update) {
          this.resolvePendingOrder(data, update.brokerOrderId);
          this.emit("orderUpdate", update);
        }
        break;
      }

      case templateIds.ExchangeOrderNotification: {
        const data = decode("ExchangeOrderNotification", msgBuf) as Record<string, unknown>;
        const update = normalizeOrderNotification(data);
        if (update) {
          this.emit("orderUpdate", update);
        }
        break;
      }

      case templateIds.InstrumentPnLPositionUpdate: {
        const data = decode("InstrumentPnLPositionUpdate", msgBuf) as Record<string, unknown>;
        const pos = normalizePositionUpdate(data);
        if (pos) {
          this.emit("position", pos);
        }
        break;
      }

      case templateIds.ResponseLogin:
      case templateIds.ResponseLogout:
      case templateIds.ResponseMarketDataUpdate:
      case templateIds.ResponseNewOrder:
      case templateIds.ResponseCancelOrder:
      case templateIds.ResponseSubscribeForOrderUpdates:
        break;

      case templateIds.Reject: {
        const data = decode("Reject", msgBuf) as Record<string, unknown>;
        console.warn(`[Rithmic] Reject: ${JSON.stringify(data.rpCode ?? data.userMsg)}`);
        break;
      }

      case templateIds.ForcedLogout:
        console.error("[Rithmic] Forced logout received");
        this._connected = false;
        this.emit("status", "disconnected");
        break;

      default:
        break;
    }
  }

  private resolvePendingOrder(data: Record<string, unknown>, orderId: string) {
    const userMsgs = data.userMsg as string[] | undefined;
    if (!userMsgs || userMsgs.length === 0) return;

    for (const tag of userMsgs) {
      const pending = this.pendingOrderMap.get(tag);
      if (pending) {
        pending.resolve(orderId);
        this.pendingOrderMap.delete(tag);
        return;
      }
    }
  }

  private toRithmicSymbol(symbol: string): string {
    return symbol;
  }

  on<K extends keyof FuturesAdapterEvents>(event: K, listener: FuturesAdapterEvents[K]): this {
    return super.on(event, listener);
  }

  emit<K extends keyof FuturesAdapterEvents>(event: K, ...args: Parameters<FuturesAdapterEvents[K]>): boolean {
    return super.emit(event, ...args);
  }
}
