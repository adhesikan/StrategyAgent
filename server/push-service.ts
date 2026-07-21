import webpush from "web-push";
import type { PushSubscription, AlertEvent } from "@shared/schema";
import { storage } from "./storage";

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:support@sunfishtrading.com";

let isConfigured = false;

export function configurePushService() {
  if (!vapidPublicKey || !vapidPrivateKey) {
    console.warn("[PushService] VAPID keys not configured - push notifications disabled");
    return false;
  }

  try {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    isConfigured = true;
    console.log("[PushService] Push notifications configured successfully");
    return true;
  } catch (error) {
    console.error("[PushService] Failed to configure VAPID:", error);
    return false;
  }
}

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, any>;
}

export async function sendPushNotification(
  subscription: PushSubscription,
  payload: PushPayload
): Promise<{ success: boolean; error?: string }> {
  if (!isConfigured) {
    return { success: false, error: "Push service not configured" };
  }

  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };

  try {
    await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
    return { success: true };
  } catch (error: any) {
    if (error.statusCode === 410 || error.statusCode === 404) {
      return { success: false, error: "Subscription expired or invalid" };
    }
    return { success: false, error: error.message || "Unknown error" };
  }
}

export async function sendAlertPushNotification(event: AlertEvent): Promise<void> {
  if (!isConfigured) {
    console.log("[PushService] Skipping push - not configured");
    return;
  }

  try {
    // Only send to subscriptions belonging to this user
    const subscriptions = await storage.getPushSubscriptionsByUserId(event.userId);
    
    if (subscriptions.length === 0) {
      console.log(`[PushService] No push subscriptions found for user ${event.userId}`);
      return;
    }

    const payload = event.payload as { message?: string; resistance?: number } | null;
    
    const pushPayload: PushPayload = {
      title: `${event.symbol} - ${event.toState}`,
      body: payload?.message || `${event.symbol} has entered ${event.toState} stage`,
      icon: "/logo.png",
      badge: "/logo.png",
      tag: `alert-${event.id}`,
      data: {
        url: `/alerts`,
        eventId: event.id,
        symbol: event.symbol,
        stage: event.toState,
      },
    };

    let successCount = 0;
    let failCount = 0;

    for (const subscription of subscriptions) {
      const result = await sendPushNotification(subscription, pushPayload);
      if (result.success) {
        successCount++;
      } else {
        failCount++;
        console.log(`[PushService] Failed to send to subscription ${subscription.id}: ${result.error}`);
      }
    }

    console.log(`[PushService] Alert push sent: ${successCount} success, ${failCount} failed for ${event.symbol}`);
  } catch (error) {
    console.error("[PushService] Error sending alert push:", error);
  }
}
