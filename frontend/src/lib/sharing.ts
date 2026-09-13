// M-E sharing library: Text / File / PDF / Image / Link (online) + branding.
// Offline options (text/file/pdf/image) never touch the network. Only
// "Share as Link" uploads a read-only copy to the backend, and callers must
// warn the user first.
import { Share, Platform } from "react-native";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";

import { writeCacheFile } from "./files";

export const BRANDING = "Made with Notes AI";

export interface ShareContent {
  title: string;
  body: string; // plain text (newline separated)
  kind?: "note" | "page";
}

const BASE = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");

function withBranding(text: string): string {
  const trimmed = (text || "").trim();
  return `${trimmed}\n\n\u2014\n\u2728 ${BRANDING}`;
}

function safeName(title: string): string {
  return (title || "note").replace(/[^a-z0-9]+/gi, "_").slice(0, 40) || "note";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------- Share as Text ----------
export async function shareAsText(content: ShareContent): Promise<"shared" | "dismissed" | "empty"> {
  const msg = [content.title?.trim(), content.body?.trim()].filter(Boolean).join("\n\n");
  if (!msg) return "empty";
  const result = await Share.share({ message: withBranding(msg), title: content.title || "Note" });
  return result.action === Share.dismissedAction ? "dismissed" : "shared";
}

// ---------- Share as File (.txt) ----------
export async function shareAsFile(content: ShareContent): Promise<boolean> {
  const text = withBranding([content.title, content.body].filter(Boolean).join("\n\n"));
  const uri = await writeCacheFile(`${safeName(content.title)}.txt`, text);
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType: "text/plain", dialogTitle: "Share note" });
  return true;
}

// ---------- Share as Markdown File (.md) ----------
export async function shareAsMarkdown(content: ShareContent): Promise<boolean> {
  const md = `# ${content.title || "Untitled"}\n\n${content.body || ""}\n\n---\n_\u2728 ${BRANDING}_\n`;
  const uri = await writeCacheFile(`${safeName(content.title)}.md`, md);
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType: "text/markdown", dialogTitle: "Share note" });
  return true;
}

// ---------- Share as PDF ----------
export async function shareAsPdf(content: ShareContent): Promise<boolean> {
  const bodyHtml = escapeHtml(content.body || "").replace(/\n/g, "<br/>");
  const html = `<html><head><meta charset="utf-8"/></head>
    <body style="font-family:-apple-system,Roboto,sans-serif;padding:40px;color:#181715">
      <div style="display:inline-block;font-size:12px;font-weight:700;color:#c2410c;background:#fff1e7;border:1px solid #fed7aa;padding:5px 11px;border-radius:999px">\u2728 ${escapeHtml(BRANDING)}</div>
      <h1 style="font-size:26px;margin:16px 0 6px">${escapeHtml(content.title || "Untitled")}</h1>
      <div style="font-size:16px;line-height:1.6;color:#333;margin-top:16px">${bodyHtml}</div>
    </body></html>`;
  const { uri } = await Print.printToFileAsync({ html });
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Share note", UTI: "com.adobe.pdf" });
  return true;
}

// ---------- Share as Image (uri from view-shot capture) ----------
export async function shareCapturedImage(uri: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share note", UTI: "public.png" });
  return true;
}

// ---------- Share as Link (online, read-only) ----------
export interface ShareLink { url: string; token: string; manageToken: string }

export async function createShareLink(content: ShareContent): Promise<ShareLink> {
  const res = await fetch(`${BASE}/api/shared`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: content.title || "Shared note",
      body: content.body || "",
      kind: content.kind || "note",
      brand: BRANDING,
    }),
  });
  if (!res.ok) throw new Error(`Share failed (${res.status})`);
  const data = await res.json();
  return { url: data.url, token: data.token, manageToken: data.manage_token };
}

export async function revokeShareLink(token: string, manageToken: string): Promise<boolean> {
  const res = await fetch(`${BASE}/api/shared/${token}?key=${encodeURIComponent(manageToken)}`, { method: "DELETE" });
  return res.ok;
}

export async function shareLinkUrl(url: string): Promise<void> {
  await Share.share(Platform.OS === "ios" ? { url, message: url } : { message: url });
}
