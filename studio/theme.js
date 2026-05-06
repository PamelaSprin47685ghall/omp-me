import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ============================================================================
// Color / Palette Utilities
// ============================================================================

export function toHexByte(value) {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, "0");
}

export function rgbToHex(r, g, b) {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

export function xterm256ToHex(index) {
  const basic16 = [
    "#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
    "#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
  ];
  if (index >= 0 && index < basic16.length) return basic16[index];
  if (index >= 16 && index <= 231) {
    const i = index - 16;
    const r = Math.floor(i / 36);
    const g = Math.floor((i % 36) / 6);
    const b = i % 6;
    const values = [0, 95, 135, 175, 215, 255];
    return rgbToHex(values[r], values[g], values[b]);
  }
  if (index >= 232 && index <= 255) {
    const gray = 8 + (index - 232) * 10;
    return rgbToHex(gray, gray, gray);
  }
  return "#000000";
}

export function hexToRgb(color) {
  const value = color.trim();
  const long = value.match(/^#([0-9a-fA-F]{6})$/);
  if (long) {
    const hex = long[1];
    return { r: Number.parseInt(hex.slice(0, 2), 16), g: Number.parseInt(hex.slice(2, 4), 16), b: Number.parseInt(hex.slice(4, 6), 16) };
  }
  const short = value.match(/^#([0-9a-fA-F]{3})$/);
  if (short) {
    const hex = short[1];
    return { r: Number.parseInt(hex[0] + hex[0], 16), g: Number.parseInt(hex[1] + hex[1], 16), b: Number.parseInt(hex[2] + hex[2], 16) };
  }
  return null;
}

export function relativeLuminance(color) {
  const rgb = hexToRgb(color);
  if (!rgb) return 0;
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

export function blendColors(a, b, t) {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  if (!rgbA || !rgbB) return a;
  return rgbToHex(
    Math.round(rgbA.r + (rgbB.r - rgbA.r) * t),
    Math.round(rgbA.g + (rgbB.g - rgbA.g) * t),
    Math.round(rgbA.b + (rgbB.b - rgbA.b) * t),
  );
}

export function withAlpha(color, alpha, fallback) {
  const rgb = hexToRgb(color);
  if (!rgb) return fallback;
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped.toFixed(2)})`;
}

export function adjustBrightness(color, factor) {
  const rgb = hexToRgb(color);
  if (!rgb) return color;
  return rgbToHex(Math.round(rgb.r * factor), Math.round(rgb.g * factor), Math.round(rgb.b * factor));
}

export function wcagRelativeLuminance(color) {
  const rgb = hexToRgb(color);
  if (!rgb) return 0;
  const linear = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(a, b) {
  const lumA = wcagRelativeLuminance(a);
  const lumB = wcagRelativeLuminance(b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

export function readableTextOn(background, darkText = "#0e1616", lightText = "#ffffff") {
  if (!hexToRgb(background)) return lightText;
  return contrastRatio(background, darkText) >= contrastRatio(background, lightText) ? darkText : lightText;
}

export function capBorderContrast(color, surface, maxContrast) {
  if (!hexToRgb(color) || !hexToRgb(surface)) return color;
  if (contrastRatio(color, surface) <= maxContrast) return color;
  let low = 0, high = 1, result = color;
  for (let i = 0; i < 12; i += 1) {
    const mid = (low + high) / 2;
    const candidate = blendColors(color, surface, mid);
    if (contrastRatio(candidate, surface) > maxContrast) { low = mid; }
    else { result = candidate; high = mid; }
  }
  return result;
}

export function deriveCanvasColors(baseColor, mode) {
  if (mode === "dark") {
    const pageBg = adjustBrightness(baseColor, 0.50);
    const cardBg = adjustBrightness(baseColor, 0.60);
    return { pageBg, cardBg, panel2: adjustBrightness(baseColor, 0.72) };
  }
  const lum = relativeLuminance(baseColor);
  const lighten = (c, amount) => {
    const rgb = hexToRgb(c);
    if (!rgb) return c;
    return rgbToHex(Math.round(rgb.r + (255 - rgb.r) * amount), Math.round(rgb.g + (255 - rgb.g) * amount), Math.round(rgb.b + (255 - rgb.b) * amount));
  };
  if (lum > 0.92) return { pageBg: baseColor, cardBg: "#ffffff", panel2: lighten(baseColor, 0.3) };
  return { pageBg: lighten(baseColor, 0.6), cardBg: lighten(baseColor, 0.93), panel2: lighten(baseColor, 0.45) };
}

// ============================================================================
// Studio Palettes (Dark / Light)
// ============================================================================

export const DARK_STUDIO_PALETTE = {
  bg: "#0f1117", panel: "#171b24", panel2: "#11161f",
  border: "#2d3748", borderMuted: "#242b38",
  text: "#e6edf3", muted: "#9aa5b1",
  accent: "#5ea1ff", warn: "#f9c74f", error: "#ff6b6b", ok: "#73d13d",
  markerBg: "rgba(94, 161, 255, 0.25)", markerBorder: "rgba(94, 161, 255, 0.65)",
  accentSoft: "rgba(94, 161, 255, 0.35)", accentSoftStrong: "rgba(94, 161, 255, 0.40)",
  okBorder: "rgba(115, 209, 61, 0.70)", warnBorder: "rgba(249, 199, 79, 0.70)",
  mdHeading: "#f0c674", mdLink: "#81a2be", mdLinkUrl: "#666666",
  mdCode: "#8abeb7", mdCodeBlock: "#b5bd68", mdCodeBlockBorder: "#808080",
  mdQuote: "#808080", mdQuoteBorder: "#808080", mdHr: "#808080", mdListBullet: "#8abeb7",
  syntaxComment: "#6A9955", syntaxKeyword: "#569CD6", syntaxFunction: "#DCDCAA",
  syntaxVariable: "#9CDCFE", syntaxString: "#CE9178", syntaxNumber: "#B5CEA8",
  syntaxType: "#4EC9B0", syntaxOperator: "#D4D4D4", syntaxPunctuation: "#D4D4D4",
};

export const LIGHT_STUDIO_PALETTE = {
  bg: "#f5f7fb", panel: "#ffffff", panel2: "#f8fafc",
  border: "#d0d7de", borderMuted: "#e0e6ee",
  text: "#1f2328", muted: "#57606a",
  accent: "#0969da", warn: "#9a6700", error: "#cf222e", ok: "#1a7f37",
  markerBg: "rgba(9, 105, 218, 0.13)", markerBorder: "rgba(9, 105, 218, 0.45)",
  accentSoft: "rgba(9, 105, 218, 0.28)", accentSoftStrong: "rgba(9, 105, 218, 0.35)",
  okBorder: "rgba(26, 127, 55, 0.55)", warnBorder: "rgba(154, 103, 0, 0.55)",
  mdHeading: "#9a7326", mdLink: "#547da7", mdLinkUrl: "#767676",
  mdCode: "#5a8080", mdCodeBlock: "#588458", mdCodeBlockBorder: "#6c6c6c",
  mdQuote: "#6c6c6c", mdQuoteBorder: "#6c6c6c", mdHr: "#6c6c6c", mdListBullet: "#588458",
  syntaxComment: "#008000", syntaxKeyword: "#0000FF", syntaxFunction: "#795E26",
  syntaxVariable: "#001080", syntaxString: "#A31515", syntaxNumber: "#098658",
  syntaxType: "#267F99", syntaxOperator: "#000000", syntaxPunctuation: "#000000",
};

// ============================================================================
// Theme Mode Inference
// ============================================================================

export function inferThemeModeFromName(name) {
  const lower = name.toLowerCase();
  if (/\b(light|dawn|day|latte)\b/.test(lower) || lower.includes("-light")) return "light";
  if (/\b(dark|night|moon|mocha)\b/.test(lower) || lower.includes("-dark")) return "dark";
  return undefined;
}

export function inferThemeModeFromColor(color) {
  if (!color || !hexToRgb(color)) return undefined;
  return relativeLuminance(color) >= 0.58 ? "light" : "dark";
}

export function inferThemeModeFromColorCandidates(...colors) {
  for (const color of colors) {
    const inferred = inferThemeModeFromColor(color);
    if (inferred) return inferred;
  }
  return undefined;
}

// ============================================================================
// Theme JSON Parsing
// ============================================================================

const themeSourceJsonCache = new Map();

export function readThemeSourceJson(theme) {
  const sourcePath = theme?.sourcePath?.trim();
  if (!sourcePath) return undefined;
  try {
    const mtimeMs = statSync(sourcePath).mtimeMs;
    const cached = themeSourceJsonCache.get(sourcePath);
    if (cached && cached.mtimeMs === mtimeMs) return cached.json ?? undefined;
    const raw = readFileSync(sourcePath, "utf-8");
    const parsed = JSON.parse(raw);
    themeSourceJsonCache.set(sourcePath, { mtimeMs, json: parsed });
    return parsed;
  } catch {
    themeSourceJsonCache.set(sourcePath, { mtimeMs: -1, json: null });
    return undefined;
  }
}

export function resolveThemeExportValue(value, vars, seen = new Set()) {
  if (value == null) return undefined;
  if (typeof value === "number") return xterm256ToHex(value);
  const token = value.trim();
  if (!token) return undefined;
  if (token.startsWith("#")) return token;
  const varKey = token.startsWith("$") ? token.slice(1) : token;
  if (!varKey || seen.has(varKey)) return token;
  const referenced = vars[varKey];
  if (referenced == null) return token;
  seen.add(varKey);
  return resolveThemeExportValue(referenced, vars, seen) ?? token;
}

export function isCssColorValue(value) {
  if (!value) return false;
  const trimmed = value.trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed) || /^rgba?\(/i.test(trimmed);
}

export function normalizeResolvedThemeColor(value) {
  if (!isCssColorValue(value)) return undefined;
  return value.trim();
}

export function resolveThemeJsonValue(value, vars) {
  return normalizeResolvedThemeColor(resolveThemeExportValue(value, vars));
}

export function readThemeExportPalette(theme) {
  const parsed = readThemeSourceJson(theme);
  if (!parsed) return undefined;
  const vars = parsed.vars ?? {};
  const exportSection = parsed.export ?? {};
  const resolved = {
    pageBg: resolveThemeJsonValue(exportSection.pageBg, vars),
    cardBg: resolveThemeJsonValue(exportSection.cardBg, vars),
    infoBg: resolveThemeJsonValue(exportSection.infoBg, vars),
  };
  return resolved.pageBg || resolved.cardBg || resolved.infoBg ? resolved : undefined;
}

export function readThemeColorToken(theme, token) {
  const parsed = readThemeSourceJson(theme);
  if (!parsed) return undefined;
  return resolveThemeJsonValue(parsed.colors?.[token], parsed.vars ?? {});
}

export function readThemeVarColor(theme, keys) {
  const parsed = readThemeSourceJson(theme);
  if (!parsed) return undefined;
  const vars = parsed.vars ?? {};
  for (const key of keys) {
    const color = resolveThemeJsonValue(vars[key], vars);
    if (color) return color;
  }
  return undefined;
}

export function readThemeAnyColor(theme, keys) {
  const parsed = readThemeSourceJson(theme);
  if (!parsed) return undefined;
  const vars = parsed.vars ?? {};
  for (const key of keys) {
    const color = resolveThemeJsonValue(parsed.colors?.[key], vars);
    if (color) return color;
  }
  return undefined;
}

export function inferThemeTextColor(theme, mode) {
  return readThemeAnyColor(theme, ["text", "userMessageText", "customMessageText", "mdCodeBlock"])
    ?? readThemeVarColor(theme, mode === "light"
      ? ["text", "fg", "foreground", "textDark1", "fg0", "fg1", "nord0"]
      : ["text", "fg", "foreground", "text", "fg0", "fg1", "subtext1", "subtext0", "nord4", "gray3"]);
}

export function inferThemeSurfaceColor(theme, role) {
  if (role === "page") return readThemeVarColor(theme, ["pageBg", "bg", "base", "background", "mantle", "bg_dark", "bg0", "nord0"]);
  if (role === "card") return readThemeVarColor(theme, ["cardBg", "surface", "base", "bg", "bg1", "nord1"]);
  return readThemeVarColor(theme, ["infoBg", "surfaceAlt", "surface0", "overlay", "bg_hl", "bg2", "nord2"]);
}

// ============================================================================
// ANSI Color Conversion
// ============================================================================

export function ansiColorToCss(ansi) {
  const trueColorMatch = ansi.match(/\x1b\[(?:38|48);2;(\d{1,3});(\d{1,3});(\d{1,3})m/);
  if (trueColorMatch) return rgbToHex(Number(trueColorMatch[1]), Number(trueColorMatch[2]), Number(trueColorMatch[3]));
  const indexedMatch = ansi.match(/\x1b\[(?:38|48);5;(\d{1,3})m/);
  if (indexedMatch) return xterm256ToHex(Number(indexedMatch[1]));
  return undefined;
}

export function safeThemeColor(getter) {
  try { return ansiColorToCss(getter()); } catch { return undefined; }
}

// ============================================================================
// Studio Theme Style (the big one — builds the full Studio palette from Theme)
// ============================================================================

export function getStudioThemeMode(theme) {
  const exported = readThemeExportPalette(theme);
  const inferredFromExport = inferThemeModeFromColorCandidates(exported?.pageBg, exported?.cardBg);
  if (inferredFromExport) return inferredFromExport;
  const inferredFromSurface = inferThemeModeFromColorCandidates(
    inferThemeSurfaceColor(theme, "page"), inferThemeSurfaceColor(theme, "card"),
    readThemeColorToken(theme, "userMessageBg"), readThemeColorToken(theme, "customMessageBg"),
    readThemeColorToken(theme, "toolPendingBg"),
  );
  if (inferredFromSurface) return inferredFromSurface;
  const inferredFromName = inferThemeModeFromName(theme?.name ?? "");
  if (inferredFromName) return inferredFromName;
  return "dark";
}

export function getStudioThemeStyle(theme) {
  const mode = getStudioThemeMode(theme);
  const fallback = mode === "light" ? LIGHT_STUDIO_PALETTE : DARK_STUDIO_PALETTE;
  if (!theme) return { mode, palette: fallback };

  const accent = safeThemeColor(() => theme.getFgAnsi("mdLink"))
    ?? safeThemeColor(() => theme.getFgAnsi("accent"))
    ?? readThemeColorToken(theme, "mdLink") ?? readThemeColorToken(theme, "accent") ?? fallback.accent;
  const warn = safeThemeColor(() => theme.getFgAnsi("warning")) ?? readThemeColorToken(theme, "warning") ?? fallback.warn;
  const error = safeThemeColor(() => theme.getFgAnsi("error")) ?? readThemeColorToken(theme, "error") ?? fallback.error;
  const ok = safeThemeColor(() => theme.getFgAnsi("success")) ?? readThemeColorToken(theme, "success") ?? fallback.ok;
  const text = safeThemeColor(() => theme.getFgAnsi("text")) ?? inferThemeTextColor(theme, mode) ?? fallback.text;
  const exported = readThemeExportPalette(theme);
  const surfaceBase = safeThemeColor(() => theme.getBgAnsi("userMessageBg"))
    ?? safeThemeColor(() => theme.getBgAnsi("customMessageBg"))
    ?? readThemeColorToken(theme, "userMessageBg") ?? readThemeColorToken(theme, "customMessageBg");
  const derived = surfaceBase ? deriveCanvasColors(surfaceBase, mode) : undefined;
  const themePageBg = inferThemeSurfaceColor(theme, "page");
  const themeCardBg = inferThemeSurfaceColor(theme, "card");
  const themePanel2 = inferThemeSurfaceColor(theme, "panel2");

  const palette = {
    bg: exported?.pageBg ?? themePageBg ?? derived?.pageBg ?? fallback.bg,
    panel: exported?.cardBg ?? themeCardBg ?? derived?.cardBg
      ?? safeThemeColor(() => theme.getBgAnsi("toolPendingBg"))
      ?? readThemeColorToken(theme, "toolPendingBg") ?? fallback.panel,
    panel2: themePanel2 ?? derived?.panel2
      ?? safeThemeColor(() => theme.getBgAnsi("selectedBg"))
      ?? readThemeColorToken(theme, "selectedBg") ?? exported?.infoBg ?? fallback.panel2,
    border: safeThemeColor(() => theme.getFgAnsi("border")) ?? readThemeColorToken(theme, "border") ?? fallback.border,
    borderMuted: safeThemeColor(() => theme.getFgAnsi("borderMuted")) ?? readThemeColorToken(theme, "borderMuted") ?? fallback.borderMuted,
    text,
    muted: safeThemeColor(() => theme.getFgAnsi("muted")) ?? readThemeColorToken(theme, "muted") ?? fallback.muted,
    accent, warn, error, ok,
    markerBg: withAlpha(accent, mode === "light" ? 0.13 : 0.25, fallback.markerBg),
    markerBorder: withAlpha(accent, mode === "light" ? 0.45 : 0.65, fallback.markerBorder),
    accentSoft: withAlpha(accent, mode === "light" ? 0.28 : 0.35, fallback.accentSoft),
    accentSoftStrong: withAlpha(accent, mode === "light" ? 0.35 : 0.40, fallback.accentSoftStrong),
    okBorder: withAlpha(ok, mode === "light" ? 0.55 : 0.70, fallback.okBorder),
    warnBorder: withAlpha(warn, mode === "light" ? 0.55 : 0.70, fallback.warnBorder),
    mdHeading: safeThemeColor(() => theme.getFgAnsi("mdHeading")) ?? readThemeColorToken(theme, "mdHeading") ?? fallback.mdHeading,
    mdLink: safeThemeColor(() => theme.getFgAnsi("mdLink")) ?? readThemeColorToken(theme, "mdLink") ?? fallback.mdLink,
    mdLinkUrl: safeThemeColor(() => theme.getFgAnsi("mdLinkUrl")) ?? readThemeColorToken(theme, "mdLinkUrl") ?? fallback.mdLinkUrl,
    mdCode: safeThemeColor(() => theme.getFgAnsi("mdCode")) ?? readThemeColorToken(theme, "mdCode") ?? fallback.mdCode,
    mdCodeBlock: safeThemeColor(() => theme.getFgAnsi("mdCodeBlock")) ?? readThemeColorToken(theme, "mdCodeBlock") ?? text,
    mdCodeBlockBorder: safeThemeColor(() => theme.getFgAnsi("mdCodeBlockBorder")) ?? readThemeColorToken(theme, "mdCodeBlockBorder") ?? fallback.mdCodeBlockBorder,
    mdQuote: safeThemeColor(() => theme.getFgAnsi("mdQuote")) ?? readThemeColorToken(theme, "mdQuote") ?? fallback.mdQuote,
    mdQuoteBorder: safeThemeColor(() => theme.getFgAnsi("mdQuoteBorder")) ?? readThemeColorToken(theme, "mdQuoteBorder") ?? fallback.mdQuoteBorder,
    mdHr: safeThemeColor(() => theme.getFgAnsi("mdHr")) ?? readThemeColorToken(theme, "mdHr") ?? fallback.mdHr,
    mdListBullet: safeThemeColor(() => theme.getFgAnsi("mdListBullet")) ?? readThemeColorToken(theme, "mdListBullet") ?? fallback.mdListBullet,
    syntaxComment: safeThemeColor(() => theme.getFgAnsi("syntaxComment")) ?? readThemeColorToken(theme, "syntaxComment") ?? fallback.syntaxComment,
    syntaxKeyword: safeThemeColor(() => theme.getFgAnsi("syntaxKeyword")) ?? readThemeColorToken(theme, "syntaxKeyword") ?? fallback.syntaxKeyword,
    syntaxFunction: safeThemeColor(() => theme.getFgAnsi("syntaxFunction")) ?? readThemeColorToken(theme, "syntaxFunction") ?? fallback.syntaxFunction,
    syntaxVariable: safeThemeColor(() => theme.getFgAnsi("syntaxVariable")) ?? readThemeColorToken(theme, "syntaxVariable") ?? fallback.syntaxVariable,
    syntaxString: safeThemeColor(() => theme.getFgAnsi("syntaxString")) ?? readThemeColorToken(theme, "syntaxString") ?? fallback.syntaxString,
    syntaxNumber: safeThemeColor(() => theme.getFgAnsi("syntaxNumber")) ?? readThemeColorToken(theme, "syntaxNumber") ?? fallback.syntaxNumber,
    syntaxType: safeThemeColor(() => theme.getFgAnsi("syntaxType")) ?? readThemeColorToken(theme, "syntaxType") ?? fallback.syntaxType,
    syntaxOperator: safeThemeColor(() => theme.getFgAnsi("syntaxOperator")) ?? readThemeColorToken(theme, "syntaxOperator") ?? fallback.syntaxOperator,
    syntaxPunctuation: safeThemeColor(() => theme.getFgAnsi("syntaxPunctuation")) ?? readThemeColorToken(theme, "syntaxPunctuation") ?? fallback.syntaxPunctuation,
  };
  return {
    mode,
    palette,
    accentContrast: readThemeVarColor(theme, ["studioAccentText", "studioAccentContrast"]),
    errorContrast: readThemeVarColor(theme, ["studioErrorText", "studioErrorContrast"]),
  };
}

// ============================================================================
// Font Detection
// ============================================================================

const DEFAULT_UI_FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const DEFAULT_PROSE_FONT_STACK = DEFAULT_UI_FONT_STACK;
const DEFAULT_MONO_FONT_FAMILIES = [
  "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", "monospace",
];
const CSS_GENERIC_FONT_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "emoji", "math", "fangsong",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
]);
let cachedStudioMonoFontStack = null;

export function sanitizeCssValue(value) {
  return value.replace(/[\r\n;]+/g, " ").trim();
}

export function getHomeDirectory() {
  return process.env.HOME ?? homedir();
}

export function getXdgConfigDirectory() {
  const configured = process.env.XDG_CONFIG_HOME?.trim();
  if (configured) return configured;
  return join(getHomeDirectory(), ".config");
}

export function stripSimpleInlineComment(value) {
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (quote) {
      if (char === quote && value[i - 1] !== "\\") quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "#") return value.slice(0, i).trim();
  }
  return value.trim();
}

export function normalizeConfiguredFontFamily(value) {
  if (!value) return undefined;
  const sanitized = sanitizeCssValue(stripSimpleInlineComment(value));
  if (!sanitized) return undefined;
  const unquoted = (sanitized.startsWith('"') && sanitized.endsWith('"'))
    || (sanitized.startsWith("'") && sanitized.endsWith("'"))
    ? sanitized.slice(1, -1).trim() : sanitized;
  return unquoted || undefined;
}

export function formatCssFontFamilyToken(value) {
  const trimmed = sanitizeCssValue(value);
  if (!trimmed) return "";
  if (CSS_GENERIC_FONT_FAMILIES.has(trimmed.toLowerCase())) return trimmed;
  if (trimmed.startsWith('"') && trimmed.endsWith('"') || trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed;
  return `"${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function readFirstExistingTextFile(paths) {
  for (const path of paths) {
    try { const text = readFileSync(path, "utf-8"); if (text.trim()) return text; } catch {}
  }
  return undefined;
}

function detectGhosttyFontFamily() {
  const home = getHomeDirectory();
  const content = readFirstExistingTextFile([
    join(getXdgConfigDirectory(), "ghostty", "config"),
    join(home, "Library", "Application Support", "com.mitchellh.ghostty", "config"),
  ]);
  if (!content) return undefined;
  const match = content.match(/^\s*font-family\s*=\s*(.+?)\s*$/m);
  return normalizeConfiguredFontFamily(match?.[1]);
}

function detectKittyFontFamily() {
  const content = readFirstExistingTextFile([join(getXdgConfigDirectory(), "kitty", "kitty.conf")]);
  if (!content) return undefined;
  const match = content.match(/^\s*font_family\s+(.+?)\s*$/m);
  return normalizeConfiguredFontFamily(match?.[1]);
}

function detectWezTermFontFamily() {
  const home = getHomeDirectory();
  const content = readFirstExistingTextFile([
    join(getXdgConfigDirectory(), "wezterm", "wezterm.lua"),
    join(home, ".wezterm.lua"),
  ]);
  if (!content) return undefined;
  const patterns = [
    /font_with_fallback\s*\(\s*\{[\s\S]*?["']([^"']+)["']/m,
    /font\s*\(\s*["']([^"']+)["']/m,
    /font\s*=\s*["']([^"']+)["']/m,
    /family\s*=\s*["']([^"']+)["']/m,
  ];
  for (const pattern of patterns) {
    const family = normalizeConfiguredFontFamily(content.match(pattern)?.[1]);
    if (family) return family;
  }
  return undefined;
}

function detectAlacrittyFontFamily() {
  const content = readFirstExistingTextFile([
    join(getXdgConfigDirectory(), "alacritty", "alacritty.toml"),
    join(getXdgConfigDirectory(), "alacritty.toml"),
    join(getXdgConfigDirectory(), "alacritty", "alacritty.yml"),
    join(getXdgConfigDirectory(), "alacritty", "alacritty.yaml"),
  ]);
  if (!content) return undefined;
  const patterns = [
    /^\s*family\s*=\s*["']([^"']+)["']\s*$/m,
    /^\s*family\s*:\s*["']?([^"'#\n]+)["']?\s*$/m,
  ];
  for (const pattern of patterns) {
    const family = normalizeConfiguredFontFamily(content.match(pattern)?.[1]);
    if (family) return family;
  }
  return undefined;
}

function detectTerminalMonospaceFontFamily() {
  const termProgram = (process.env.TERM_PROGRAM ?? "").trim().toLowerCase();
  const term = (process.env.TERM ?? "").trim().toLowerCase();
  if (termProgram === "ghostty" || term.includes("ghostty")) return detectGhosttyFontFamily();
  if (termProgram === "wezterm") return detectWezTermFontFamily();
  if (termProgram === "kitty" || term.includes("kitty")) return detectKittyFontFamily();
  if (termProgram === "alacritty") return detectAlacrittyFontFamily();
  return undefined;
}

export function buildMonoFontStack(primaryFamily) {
  const entries = [];
  const seen = new Set();
  const push = (family) => {
    const trimmed = family.trim();
    if (!trimmed) return;
    const key = trimmed.replace(/^['"]|['"]$/g, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(formatCssFontFamilyToken(trimmed));
  };
  if (primaryFamily) push(primaryFamily);
  for (const family of DEFAULT_MONO_FONT_FAMILIES) push(family);
  return entries.join(", ");
}

export function getStudioMonoFontStack() {
  if (cachedStudioMonoFontStack) return cachedStudioMonoFontStack;
  const override = sanitizeCssValue(process.env.PI_STUDIO_FONT_MONO ?? "");
  if (override) { cachedStudioMonoFontStack = override; return cachedStudioMonoFontStack; }
  cachedStudioMonoFontStack = buildMonoFontStack(detectTerminalMonospaceFontFamily());
  return cachedStudioMonoFontStack;
}

export function getStudioUiFontStack() {
  return sanitizeCssValue(process.env.PI_STUDIO_FONT_UI ?? "") || DEFAULT_UI_FONT_STACK;
}

export function getStudioProseFontStack() {
  return sanitizeCssValue(process.env.PI_STUDIO_FONT_PROSE ?? "") || DEFAULT_PROSE_FONT_STACK;
}

// ============================================================================
// Build Theme CSS Vars
// ============================================================================

export function buildThemeCssVars(style) {
  const shadowColor = style.mode === "light"
    ? withAlpha(style.palette.text, 0.10, "rgba(15, 23, 42, 0.08)")
    : "rgba(0, 0, 0, 0.32)";
  const panelShadow = style.mode === "light"
    ? `0 1px 2px ${withAlpha(style.palette.text, 0.035, "rgba(15, 23, 42, 0.03)")}, 0 4px 14px ${withAlpha(style.palette.text, 0.055, "rgba(15, 23, 42, 0.04)")}`
    : "0 1px 2px rgba(0, 0, 0, 0.30), 0 6px 18px rgba(0, 0, 0, 0.18)";
  const rawBorderSubtle = blendColors(style.palette.borderMuted, style.palette.panel, style.mode === "light" ? 0.58 : 0.48);
  const rawPanelBorder = blendColors(style.palette.borderMuted, style.palette.panel, style.mode === "light" ? 0.42 : 0.36);
  const rawControlBorder = blendColors(style.palette.borderMuted, style.palette.panel, style.mode === "light" ? 0.30 : 0.22);
  const rawPaneActiveBorder = blendColors(style.palette.border, style.palette.panel, style.mode === "light" ? 0.34 : 0.48);
  const borderSubtle = capBorderContrast(rawBorderSubtle, style.palette.panel, style.mode === "light" ? 1.10 : 1.12);
  const panelBorder = capBorderContrast(rawPanelBorder, style.palette.panel, style.mode === "light" ? 1.15 : 1.18);
  const controlBorder = capBorderContrast(rawControlBorder, style.palette.panel, style.mode === "light" ? 1.22 : 1.25);
  const paneActiveBorder = capBorderContrast(rawPaneActiveBorder, style.palette.panel, style.mode === "light" ? 1.38 : 1.45);
  const accentContrast = style.accentContrast ?? (style.mode === "light" ? "#ffffff" : "#0e1616");
  const errorContrast = style.errorContrast ?? readableTextOn(style.palette.error);
  const quoteText = blendColors(style.palette.text, style.palette.mdQuote, style.mode === "light" ? 0.34 : 0.28);
  const quoteBorder = blendColors(style.palette.mdQuoteBorder, style.palette.text, style.mode === "light" ? 0.18 : 0.24);
  const markdownMarkerText = blendColors(style.palette.text, style.palette.muted, style.mode === "light" ? 0.28 : 0.24);
  const linkText = blendColors(style.palette.text, style.palette.mdLink, style.mode === "light" ? 0.62 : 0.58);
  const linkUrlText = blendColors(linkText, style.palette.mdLinkUrl, style.mode === "light" ? 0.22 : 0.18);
  const linkDecoration = withAlpha(linkText, style.mode === "light" ? 0.42 : 0.50, style.mode === "light" ? "rgba(84, 125, 167, 0.42)" : "rgba(129, 162, 190, 0.50)");
  const listMarkerText = blendColors(markdownMarkerText, style.palette.mdListBullet, style.mode === "light" ? 0.46 : 0.42);
  const blockquoteBg = withAlpha(quoteBorder, style.mode === "light" ? 0.10 : 0.15, style.mode === "light" ? "rgba(15, 23, 42, 0.04)" : "rgba(255, 255, 255, 0.05)");
  const tableAltBg = withAlpha(style.palette.mdCodeBlockBorder, style.mode === "light" ? 0.10 : 0.14, style.mode === "light" ? "rgba(15, 23, 42, 0.03)" : "rgba(255, 255, 255, 0.04)");
  const inlineCodeBg = withAlpha(style.palette.mdCodeBlockBorder, style.mode === "light" ? 0.13 : 0.18, style.mode === "light" ? "rgba(15, 23, 42, 0.06)" : "rgba(255, 255, 255, 0.07)");
  const rawCodeBlockBorder = blendColors(style.palette.mdCodeBlockBorder, style.palette.panel2, style.mode === "light" ? 0.62 : 0.72);
  const codeBlockBorder = capBorderContrast(rawCodeBlockBorder, style.palette.panel2, style.mode === "light" ? 1.16 : 1.18);
  const diffAddedBg = withAlpha(style.palette.ok, style.mode === "light" ? 0.10 : 0.14, "rgba(46, 160, 67, 0.12)");
  const diffRemovedBg = withAlpha(style.palette.error, style.mode === "light" ? 0.10 : 0.14, "rgba(248, 81, 73, 0.12)");
  const okSoft = withAlpha(style.palette.ok, style.mode === "light" ? 0.10 : 0.12, "rgba(115, 209, 61, 0.08)");
  const errorSoft = withAlpha(style.palette.error, style.mode === "light" ? 0.10 : 0.12, "rgba(255, 107, 107, 0.08)");
  const backdropBg = style.mode === "light" ? "rgba(15, 23, 42, 0.20)" : "rgba(0, 0, 0, 0.48)";
  const panelLum = hexToRgb(style.palette.panel) ? relativeLuminance(style.palette.panel) : null;
  const panel2Lum = hexToRgb(style.palette.panel2) ? relativeLuminance(style.palette.panel2) : null;
  const lightPrimarySurface = panelLum != null && panel2Lum != null && panel2Lum > panelLum ? style.palette.panel2 : style.palette.panel;
  const lightSecondarySurface = lightPrimarySurface === style.palette.panel ? style.palette.panel2 : style.palette.panel;
  const editorBg = style.mode === "light" ? lightPrimarySurface : style.palette.panel;
  const editorGutterBg = style.mode === "light" ? lightSecondarySurface : style.palette.panel2;
  const referenceMetaBg = style.mode === "light" ? lightSecondarySurface : style.palette.panel2;
  const referenceBadgeBg = style.mode === "light" ? lightPrimarySurface : style.palette.panel;
  const scratchpadHeaderBg = style.mode === "light" ? lightSecondarySurface : style.palette.panel2;
  const scratchpadBodyBg = style.mode === "light" ? lightPrimarySurface : style.palette.panel;
  const infoText = blendColors(style.palette.text, style.palette.muted, style.mode === "light" ? 0.36 : 0.30);
  const footerText = blendColors(style.palette.text, style.palette.muted, style.mode === "light" ? 0.50 : 0.42);
  const headerActionBg = style.mode === "light" ? lightPrimarySurface : "transparent";
  const headerActionHoverBg = style.mode === "light" ? lightPrimarySurface : style.palette.panel2;
  const headerActionBorder = style.mode === "light" ? controlBorder : "transparent";
  const headerFilledBg = style.mode === "light" ? lightPrimarySurface : style.palette.panel2;
  const monoFontStack = getStudioMonoFontStack();
  const uiFontStack = getStudioUiFontStack();
  const proseFontStack = getStudioProseFontStack();

  return {
    "color-scheme": style.mode,
    "--bg": style.palette.bg, "--panel": style.palette.panel, "--panel-2": style.palette.panel2,
    "--border": style.palette.border, "--border-muted": style.palette.borderMuted, "--border-subtle": borderSubtle,
    "--panel-border": panelBorder, "--control-border": controlBorder, "--pane-active-border": paneActiveBorder,
    "--text": style.palette.text, "--muted": style.palette.muted,
    "--accent": style.palette.accent, "--warn": style.palette.warn, "--error": style.palette.error, "--ok": style.palette.ok,
    "--marker-bg": style.palette.markerBg, "--marker-border": style.palette.markerBorder,
    "--accent-soft": style.palette.accentSoft, "--accent-soft-strong": style.palette.accentSoftStrong,
    "--ok-border": style.palette.okBorder, "--warn-border": style.palette.warnBorder,
    "--md-heading": style.palette.mdHeading, "--md-link": style.palette.mdLink, "--md-link-url": style.palette.mdLinkUrl,
    "--md-code": style.palette.mdCode, "--md-codeblock": style.palette.mdCodeBlock, "--md-codeblock-border": codeBlockBorder,
    "--md-quote": style.palette.mdQuote, "--md-quote-border": style.palette.mdQuoteBorder,
    "--studio-quote-text": quoteText, "--studio-quote-border": quoteBorder,
    "--studio-markdown-marker-text": markdownMarkerText,
    "--studio-link": linkText, "--studio-link-url": linkUrlText, "--studio-link-decoration": linkDecoration,
    "--studio-list-marker-text": listMarkerText,
    "--md-hr": style.palette.mdHr, "--md-list-bullet": style.palette.mdListBullet,
    "--syntax-comment": style.palette.syntaxComment, "--syntax-keyword": style.palette.syntaxKeyword,
    "--syntax-function": style.palette.syntaxFunction, "--syntax-variable": style.palette.syntaxVariable,
    "--syntax-string": style.palette.syntaxString, "--syntax-number": style.palette.syntaxNumber,
    "--syntax-type": style.palette.syntaxType, "--syntax-operator": style.palette.syntaxOperator,
    "--syntax-punctuation": style.palette.syntaxPunctuation,
    "--panel-shadow": panelShadow, "--shadow-color": shadowColor,
    "--accent-contrast": accentContrast, "--error-contrast": errorContrast,
    "--blockquote-bg": blockquoteBg, "--inline-code-bg": inlineCodeBg, "--table-alt-bg": tableAltBg,
    "--md-table-border": borderSubtle,
    "--diff-added-bg": diffAddedBg, "--diff-removed-bg": diffRemovedBg,
    "--ok-soft": okSoft, "--error-soft": errorSoft, "--backdrop-bg": backdropBg,
    "--editor-bg": editorBg, "--editor-gutter-bg": editorGutterBg,
    "--reference-meta-bg": referenceMetaBg, "--reference-badge-bg": referenceBadgeBg,
    "--scratchpad-header-bg": scratchpadHeaderBg, "--scratchpad-body-bg": scratchpadBodyBg,
    "--studio-info-text": infoText, "--studio-footer-text": footerText,
    "--studio-header-action-bg": headerActionBg, "--studio-header-action-hover-bg": headerActionHoverBg,
    "--studio-header-action-border": headerActionBorder, "--studio-header-filled-bg": headerFilledBg,
    "--font-ui": uiFontStack, "--font-prose": proseFontStack, "--font-mono": monoFontStack,
  };
}
