// Single source of truth for customer-facing product identity.
// Deliberately free of: prices, taxes, domains, contact details, feature
// availability promises and anything legal-status dependent.

export const PRODUCT = {
  name: "VivaahVarnam",
  descriptor: "Digital Wedding Patrika",
  tagline: "Tradition, beautifully invited.",
  status: "Preview",
  market: "South India first",
} as const;

export const PRODUCT_STATUS_LABEL = `${PRODUCT.name} — ${PRODUCT.status}`;
