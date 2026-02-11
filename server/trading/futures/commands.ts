import { z } from "zod";

export const subscribeCommandSchema = z.object({
  commandType: z.literal("subscribe"),
  symbol: z.string().min(1).max(10),
});

export const unsubscribeCommandSchema = z.object({
  commandType: z.literal("unsubscribe"),
  symbol: z.string().min(1).max(10),
});

export const placeOrderCommandSchema = z.object({
  commandType: z.literal("placeOrder"),
  symbol: z.string().min(1).max(10),
  side: z.enum(["buy", "sell"]),
  qty: z.number().int().min(1).max(100),
  orderType: z.enum(["market", "limit", "stop"]),
  limitPrice: z.number().optional(),
  stopPrice: z.number().optional(),
  linkedToOrderId: z.string().optional(),
});

export const cancelOrderCommandSchema = z.object({
  commandType: z.literal("cancelOrder"),
  brokerOrderId: z.string().min(1),
});

export const toggleAgentCommandSchema = z.object({
  commandType: z.literal("toggleAgent"),
  enabled: z.boolean(),
  symbol: z.string().min(1).max(10).optional(),
  rules: z
    .object({
      minScore: z.number().min(0).max(100).optional(),
      maxTradesPerDay: z.number().int().min(1).max(50).optional(),
      maxPosition: z.number().int().min(1).max(20).optional(),
      sizeMode: z.enum(["contracts", "dollars"]).optional(),
      tradeSize: z.number().min(1).optional(),
      entryTimeStart: z.string().optional(),
      entryTimeEnd: z.string().optional(),
      exitTime: z.string().optional(),
      takeProfit: z.number().min(0).optional(),
      stopLoss: z.number().min(0).optional(),
    })
    .optional(),
});

export const futuresCommandSchema = z.discriminatedUnion("commandType", [
  subscribeCommandSchema,
  unsubscribeCommandSchema,
  placeOrderCommandSchema,
  cancelOrderCommandSchema,
  toggleAgentCommandSchema,
]);

export type FuturesCommandPayload = z.infer<typeof futuresCommandSchema>;
