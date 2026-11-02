import { useEffect, useState } from "react";
import { Check, Palette } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./form-primitives";

// Preset colors for theme selection
const presetColors = [
  { name: "Blue", value: "#3b82f6" },
  { name: "Indigo", value: "#6366f1" },
  { name: "Purple", value: "#8b5cf6" },
  { name: "Pink", value: "#ec4899" },
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Yellow", value: "#eab308" },
  { name: "Lime", value: "#84cc16" },
  { name: "Green", value: "#22c55e" },
  { name: "Emerald", value: "#10b981" },
  { name: "Teal", value: "#14b8a6" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Sky", value: "#0ea5e9" },
  { name: "Gray", value: "#6b7280" },
  { name: "Slate", value: "#64748b" },
];

const STORAGE_KEY = "codex-switcher-theme-color";

// Helper function to lighten a color
function lightenColor(color: string, amount: number): string {
  const hex = color.replace("#", "");
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const newR = Math.round(r + (255 - r) * amount);
  const newG = Math.round(g + (255 - g) * amount);
  const newB = Math.round(b + (255 - b) * amount);
  return `#${newR.toString(16).padStart(2, "0")}${newG.toString(16).padStart(2, "0")}${newB.toString(16).padStart(2, "0")}`;
}

// Helper function to darken a color
function darkenColor(color: string, amount: number): string {
  const hex = color.replace("#", "");
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const newR = Math.round(r * (1 - amount));
  const newG = Math.round(g * (1 - amount));
  const newB = Math.round(b * (1 - amount));
  return `#${newR.toString(16).padStart(2, "0")}${newG.toString(16).padStart(2, "0")}${newB.toString(16).padStart(2, "0")}`;
}

// Helper function to add alpha to a color
function addAlpha(color: string, alpha: number): string {
  const hex = color.replace("#", "");
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Apply theme color to CSS variables
function applyThemeColor(color: string) {
  document.documentElement.style.setProperty("--cs-primary", color);
  document.documentElement.style.setProperty("--cs-primary-foreground", "#ffffff");
  // Generate a lighter version for selected background
  const lighterColor = lightenColor(color, 0.9);
  document.documentElement.style.setProperty("--cs-selected-background", lighterColor);
  // Generate a darker version for selected foreground
  const darkerColor = darkenColor(color, 0.3);
  document.documentElement.style.setProperty("--cs-selected-foreground", darkerColor);
  // Generate border color
  const borderColor = addAlpha(color, 0.55);
  document.documentElement.style.setProperty("--cs-selected-border", borderColor);
}

export function ThemeColorSettings({ language }: { language: "zh" | "en" | "ja" }) {
  const [themeColorPickerOpen, setThemeColorPickerOpen] = useState(false);
  const [currentThemeColor, setCurrentThemeColor] = useState("#3b82f6");

  // Load theme color from localStorage on mount
  useEffect(() => {
    const savedColor = localStorage.getItem(STORAGE_KEY);
    if (savedColor) {
      setCurrentThemeColor(savedColor);
      applyThemeColor(savedColor);
    }
  }, []);

  // Handle theme color change
  function handleThemeColorChange(color: string) {
    setCurrentThemeColor(color);
    applyThemeColor(color);
  }

  // Save theme color to localStorage
  function saveThemeColor(color: string) {
    localStorage.setItem(STORAGE_KEY, color);
    applyThemeColor(color);
  }

  return (
    <div className="space-y-4 rounded-lg bg-[#f7f8fa] px-4 py-3">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="text-[13px] font-medium text-foreground">
            {language === "zh" ? "当前主题色" : language === "ja" ? "現在のテーマカラー" : "Current theme color"}
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {language === "zh" ? "选择预设颜色或自定义颜色" : language === "ja" ? "プリセットカラーまたはカスタムカラーを選択" : "Choose a preset or customize"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="size-8 rounded-lg border border-black/[0.08] shadow-sm"
            style={{ backgroundColor: currentThemeColor }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setThemeColorPickerOpen(!themeColorPickerOpen)}
          >
            <Palette className="mr-1.5 size-3.5" />
            {language === "zh" ? "选择颜色" : language === "ja" ? "色を選択" : "Choose Color"}
          </Button>
        </div>
      </div>

      {themeColorPickerOpen ? (
        <div className="space-y-3 border-t border-black/[0.06] pt-3">
          <div className="grid grid-cols-8 gap-2">
            {presetColors.map((color) => (
              <button
                key={color.value}
                type="button"
                className={cn(
                  "size-8 rounded-lg border-2 transition-all hover:scale-105",
                  currentThemeColor === color.value
                    ? "border-primary scale-110"
                    : "border-transparent hover:border-black/[0.1]"
                )}
                style={{ backgroundColor: color.value }}
                onClick={() => handleThemeColorChange(color.value)}
                title={color.name}
              />
            ))}
          </div>

          <div className="flex items-center gap-3">
            <label className="text-[13px] font-medium text-foreground">
              {language === "zh" ? "自定义颜色" : language === "ja" ? "カスタムカラー" : "Custom color"}
            </label>
            <input
              type="color"
              value={currentThemeColor}
              onChange={(e) => handleThemeColorChange(e.target.value)}
              className="size-10 cursor-pointer rounded-lg border border-black/[0.08]"
            />
            <Input
              value={currentThemeColor}
              onChange={(e) => handleThemeColorChange(e.target.value)}
              placeholder="#000000"
              className="h-9 flex-1 rounded-lg border-border bg-white text-[13px] shadow-none"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setThemeColorPickerOpen(false)}
            >
              {language === "zh" ? "取消" : language === "ja" ? "キャンセル" : "Cancel"}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                saveThemeColor(currentThemeColor);
                setThemeColorPickerOpen(false);
              }}
            >
              <Check className="mr-1.5 size-3.5" />
              {language === "zh" ? "保存" : language === "ja" ? "保存" : "Save"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
