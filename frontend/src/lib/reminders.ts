// Local reminders. Uses expo-notifications when available (native), otherwise
// degrades gracefully to in-app reminders. Never crashes / needs no server.
import { Platform } from "react-native";

let Notifications: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require("expo-notifications");
} catch {
  Notifications = null;
}

const CHANNEL_ID = "reminders";
let configured = false;
let channelReady = false;

export type PermissionState = "granted" | "denied" | "unsupported";

async function setupChannel(): Promise<void> {
  if (channelReady || Platform.OS !== "android" || !Notifications) return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Reminders",
      importance: Notifications.AndroidImportance?.HIGH ?? 4,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#E8752E",
      sound: "default",
    });
    channelReady = true;
  } catch {
    // ignore
  }
}

async function ensure(request = true): Promise<boolean> {
  if (!Notifications || Platform.OS === "web") return false;
  try {
    if (!configured) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      configured = true;
    }
    await setupChannel();
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) {
      if (!request) return false;
      const req = await Notifications.requestPermissionsAsync();
      if (!req.granted) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Ask the user for notification permission up-front (used by reminder toggles).
export async function requestReminderPermission(): Promise<PermissionState> {
  if (!Notifications || Platform.OS === "web") return "unsupported";
  const ok = await ensure(true);
  return ok ? "granted" : "denied";
}

export async function reminderPermissionStatus(): Promise<PermissionState> {
  if (!Notifications || Platform.OS === "web") return "unsupported";
  try {
    const perm = await Notifications.getPermissionsAsync();
    return perm.granted ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

export async function scheduleReminder(
  title: string,
  body: string,
  when: Date,
): Promise<string | null> {
  try {
    const ok = await ensure(true);
    if (!ok) return null;
    if (when.getTime() <= Date.now()) return null;
    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: "default" },
      trigger:
        Platform.OS === "android"
          ? { type: "date", date: when, channelId: CHANNEL_ID }
          : { type: "date", date: when },
    });
    return id;
  } catch {
    return null;
  }
}

export async function cancelReminder(id: string | null): Promise<void> {
  try {
    if (id && Notifications && Platform.OS !== "web") {
      await Notifications.cancelScheduledNotificationAsync(id);
    }
  } catch {
    // ignore
  }
}

export function reminderSupported(): boolean {
  return !!Notifications && Platform.OS !== "web";
}
