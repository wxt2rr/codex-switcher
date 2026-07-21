import type { ReactNode } from "react";

export type SelectFieldItem = {
  value: string;
  label?: string;
  iconUrl?: string;
  actionLabel?: string;
  actionIcon?: ReactNode;
  actionDisabled?: boolean;
  onAction?: () => void;
};

export function toSelectItems(items: SelectFieldItem[]) {
  return items.map((item) => ({
    value: item.value,
    label: item.label ?? item.value,
    ...(item.iconUrl ? { iconUrl: item.iconUrl } : {}),
    ...(item.actionLabel ? { actionLabel: item.actionLabel } : {}),
    ...(item.actionIcon ? { actionIcon: item.actionIcon } : {}),
    ...(item.actionDisabled ? { actionDisabled: true } : {}),
    ...(item.onAction ? { onAction: item.onAction } : {}),
  }));
}
