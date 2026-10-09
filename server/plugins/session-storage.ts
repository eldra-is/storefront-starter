import redisDriver from 'unstorage/drivers/redis';
import { SESSION_STORAGE, chooseSessionStore } from '~~/shared/utils/auth';
import { boundedMemoryDriver } from '../utils/memory-session-driver';

/**
 * Business-login sessions live in `useStorage('eldra-session')`, mounted here at start-up from
 * runtime config: Redis when NUXT_SESSION_STORAGE_DRIVER=redis (the URL, which may hold a password,
 * comes from the environment and never from the build), otherwise a bounded in-memory store. In
 * production with business login configured, memory must be asked for explicitly; anything else
 * stops the server with the reason rather than signing people out at random.
 */
export default defineNitroPlugin(() => {
  const { sessionStorage, shopClientSecret } = useRuntimeConfig();
  const choice = chooseSessionStore({
    driver: String(sessionStorage.driver ?? ''),
    url: String(sessionStorage.url ?? ''),
    production: !import.meta.dev,
    businessLoginConfigured: Boolean(shopClientSecret),
  });
  if (choice.kind === 'error') throw new Error(`[auth] ${choice.message}`);
  useStorage().mount(
    SESSION_STORAGE,
    choice.kind === 'redis'
      ? redisDriver({ url: String(sessionStorage.url), base: SESSION_STORAGE })
      : boundedMemoryDriver({})
  );
});
