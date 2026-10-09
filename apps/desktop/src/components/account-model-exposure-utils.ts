import type {
  AccountDiscoveredModel,
  AccountModelDiscoverySnapshot,
  CustomModelRecord,
  ModelCatalogSnapshot,
} from "../bridge";

export type AccountModelDiscoveryByKey = Map<string, AccountDiscoveredModel>;

function providerModelKeyOf(model: CustomModelRecord): string {
  return typeof model.entry.provider_model_key === "string"
    ? model.entry.provider_model_key.trim()
    : "";
}

/**
 * Builds the selectable catalog for exactly one account.
 *
 * Discovered records are account-scoped by the current discovery snapshot.
 * A record with a provider model key that belongs to another account is not a
 * manual model and must not be promoted into this account's candidate list.
 * Previously selected records remain visible so an existing bad binding can
 * still be removed by the user.
 */
export function buildAccountModelCandidates(
  snapshot: ModelCatalogSnapshot,
  accountKey: string,
  selectedIds: string[],
): CustomModelRecord[] {
  const discoveryKeys = new Set(
    (snapshot.accountModelDiscoveries?.[accountKey]?.models ?? [])
      .map((model) => model.providerModelKey),
  );
  const discoveredRecords = snapshot.models.filter((model) => {
    const key = providerModelKeyOf(model);
    return Boolean(key) && discoveryKeys.has(key);
  });
  const manualRecords = snapshot.models.filter((model) => !providerModelKeyOf(model));
  const selectedHistory = snapshot.models.filter((model) => selectedIds.includes(model.id));
  const byId = new Map<string, CustomModelRecord>();
  for (const model of [...discoveredRecords, ...manualRecords, ...selectedHistory]) {
    byId.set(model.id, model);
  }
  return [...byId.values()];
}

/**
 * The current account discovery snapshot is the source of truth for a
 * discovered record. Explicit provider metadata is only used for manual or
 * historical records that are not present in the current snapshot.
 */
export function providerIdForAccountModel(
  model: CustomModelRecord,
  discoveryByProviderKey: AccountModelDiscoveryByKey,
): string {
  const discovered = discoveryByProviderKey.get(providerModelKeyOf(model));
  if (discovered?.providerId) return discovered.providerId;
  const explicitProviderId = typeof model.entry.provider_id === "string"
    ? model.entry.provider_id.trim()
    : "";
  return explicitProviderId || "custom";
}

export function discoveryByProviderKeyOf(
  snapshot: ModelCatalogSnapshot,
  accountKey: string,
): AccountModelDiscoveryByKey {
  const discovery: AccountModelDiscoverySnapshot | undefined = snapshot.accountModelDiscoveries?.[accountKey];
  return new Map((discovery?.models ?? []).map((model) => [model.providerModelKey, model]));
}
