export function parseCategoryIds(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => String(entry).trim())
          .filter(Boolean);
      }
    } catch {
      return [];
    }
  }

  return trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function isCategoryAllowed(
  stockTypeCode: string,
  scheduleCategoryIds: string[],
  itemCategoryId: string | null,
): boolean {
  if (stockTypeCode !== "STOCK_PARTIAL") {
    return true;
  }
  if (!itemCategoryId) {
    return false;
  }
  return scheduleCategoryIds.includes(itemCategoryId.trim());
}
