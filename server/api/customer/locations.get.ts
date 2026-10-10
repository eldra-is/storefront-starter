/**
 * The active company's delivery locations (`{ data }`, the default first; `[]` for none), for the
 * order-on-account form. Signed in only; never cached.
 */
export default defineEventHandler((event) =>
  businessCall(event, 'read', (eldra, context) => eldra.customer.locations(context))
);
