import redisDriver from 'unstorage/drivers/redis';
import { SESSION_STORAGE } from '~~/shared/utils/auth';

/**
 * Business-login sessions live in `useStorage('eldra-session')`: process memory by default
 * (nuxt.config.ts), Redis when NUXT_SESSION_STORAGE_DRIVER=redis. Mounted here, at runtime, so the
 * Redis URL (which may hold a password) comes from the environment and never from the build.
 */
export default defineNitroPlugin(() => {
  const { sessionStorage, shopClientSecret } = useRuntimeConfig();
  if (sessionStorage.driver === 'redis') {
    if (!sessionStorage.url) throw new Error('NUXT_SESSION_STORAGE_URL is required for redis.');
    // nuxt.config.ts mounts memory here; unstorage refuses a second mount on the same base.
    // unmount without dispose removes it synchronously, before the Redis mount below.
    void useStorage().unmount(SESSION_STORAGE, false);
    useStorage().mount(
      SESSION_STORAGE,
      redisDriver({ url: sessionStorage.url, base: 'eldra-session' })
    );
    return;
  }
  if (!import.meta.dev && shopClientSecret) {
    console.warn(
      '[auth] Business-login sessions are kept in memory: they end on restart and are not shared ' +
        'between server instances. Set NUXT_SESSION_STORAGE_DRIVER=redis for production.'
    );
  }
});
