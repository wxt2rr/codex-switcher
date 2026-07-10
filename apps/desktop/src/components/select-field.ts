export type SelectFieldItem = {
  value: string;
  label?: string;
};

export function toSelectItems(items: SelectFieldItem[]) {
  return items.map((item) => ({
    value: item.value,
    label: item.label ?? item.value,
  }));
}
