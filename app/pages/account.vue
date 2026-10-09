<script setup lang="ts">
import type { EldraCustomerMe } from '@eldrajs/sdk';
import { DEFAULT_RETURN_TO, accountState } from '~~/shared/utils/auth';

const { t } = useLocale();
const route = useRoute();
const businessLogin = useBusinessLogin();

if (!businessLogin.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found' });
}

// Same-origin cookie on the browser, forwarded by useFetch on the server; the tokens stay server-side.
const { data, error } = await useFetch<EldraCustomerMe>('/api/auth/me', {
  key: 'account-me',
  retry: false,
});

const state = computed(() =>
  accountState(error.value ? (error.value.statusCode ?? 500) : data.value ? undefined : 401)
);
const me = computed(() => (state.value === 'signed-in' ? data.value : null));
const fullName = computed(() =>
  [me.value?.shopUser.firstName, me.value?.shopUser.lastName].filter(Boolean).join(' ')
);
const signInFailed = computed(() => route.query.signin === 'failed');
// Full page loads: the auth routes are server routes, not pages.
const signInHref = `/auth/login?returnTo=${encodeURIComponent(DEFAULT_RETURN_TO)}`;

const button =
  'border-ink bg-paper text-ink hover:bg-ink hover:text-paper inline-flex min-h-11 items-center justify-center border px-6 text-[11px] tracking-[0.14em] uppercase transition-colors duration-150';

useSeoMeta({ title: () => t('account'), robots: 'noindex, nofollow' });
</script>

<template>
  <div class="px-[clamp(16px,4vw,48px)] py-16" data-testid="account">
    <h1 class="text-[clamp(22px,3.2vw,34px)] leading-[1.15] font-light tracking-[0.08em] uppercase">
      {{ t('account') }}
    </h1>

    <p
      v-if="signInFailed && state !== 'signed-in'"
      class="text-accent mt-4 text-xs"
      role="alert"
      data-testid="account-signin-failed"
    >
      {{ t('signInFailed') }}
    </p>

    <div
      v-if="state === 'signed-out'"
      class="mt-8 grid justify-items-start gap-6"
      data-testid="account-signed-out"
    >
      <p class="text-muted">{{ t('signInIntro') }}</p>
      <a :href="signInHref" :class="button" data-testid="account-sign-in">{{ t('signIn') }}</a>
    </div>

    <div v-else-if="me" class="mt-10 grid max-w-3xl gap-12" data-testid="account-signed-in">
      <section>
        <p class="text-lg" data-testid="account-name">{{ fullName }}</p>
        <p class="text-muted mt-1">
          <span class="sr-only">{{ t('email') }}: </span>
          <span data-testid="account-email">{{ me.shopUser.email }}</span>
        </p>
      </section>

      <section>
        <h2 class="text-[11px] tracking-[0.14em] uppercase">{{ t('companies') }}</h2>
        <ul class="border-rule m-0 mt-4 list-none border-t p-0" data-testid="account-companies">
          <li
            v-for="membership in me.memberships"
            :key="membership.customerId"
            class="border-rule grid gap-1 border-b py-4"
            :data-testid="`account-company-${membership.customerId}`"
          >
            <span class="font-medium">{{ membership.customerName }}</span>
            <span class="text-muted text-sm">
              {{ t('customerNumber') }}: {{ membership.number }} · {{ t('role') }}:
              {{ membership.role === 'ADMIN' ? t('roleAdmin') : t('roleBuyer') }}
              <template v-if="membership.status === 'INVITED'"> · {{ t('invited') }}</template>
            </span>
          </li>
        </ul>
      </section>

      <div>
        <form method="post" action="/auth/logout">
          <button type="submit" :class="button" data-testid="account-sign-out">
            {{ t('signOut') }}
          </button>
        </form>
      </div>
    </div>

    <div
      v-else-if="state === 'no-membership'"
      class="mt-8 grid justify-items-start gap-6"
      data-testid="account-no-membership"
    >
      <p class="text-muted">{{ t('noMembership') }}</p>
      <form method="post" action="/auth/logout">
        <button type="submit" :class="button" data-testid="account-sign-out">
          {{ t('signOut') }}
        </button>
      </form>
    </div>

    <p
      v-else-if="state === 'unavailable'"
      class="text-muted mt-8"
      data-testid="account-unavailable"
    >
      {{ t('accountUnavailable') }}
    </p>

    <p v-else class="text-muted mt-8" role="alert" data-testid="account-error">
      {{ t('accountError') }}
    </p>
  </div>
</template>
