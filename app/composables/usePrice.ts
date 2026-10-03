/** formatPrice with the visitor's locale and, unless a cart says otherwise, the organization's currency. */
export function usePrice() {
  const { locale } = useLocale();
  const organization = useOrganization();
  return (amount: number, currency?: string | null) =>
    formatPrice(amount, currency ?? organization.value.currency, locale.value);
}
