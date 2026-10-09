/**
 * A sign-out link or a typed URL ends nothing (sign-out is a POST from the account page, so no
 * other site can trigger it); it goes to the account page, where the sign-out button is.
 */
export default defineEventHandler((event) => {
  authResponseHeaders(event);
  return sendRedirect(event, '/account', 302);
});
