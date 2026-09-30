<script setup lang="ts">
import { PhCaretDown, PhHandbagSimple } from '@phosphor-icons/vue';
import type { Locale } from '~/utils/organization';
import type { HeaderNavigationItem } from '~/utils/navigation';

const { locale, locales, setLocale, t } = useLocale();
const organization = useOrganization();
const brand = useAppConfig().brand.name;
const cartStore = useCartStore();
const menuOpen = ref(false);
const catalogMenuOpenId = ref<string | null>(null);
const route = useRoute();

const { data: header } = await useAsyncData(
  () => `site-header:${locale.value}`,
  () => useCms().header()
);

const { data: categories } = await useAsyncData(
  () => `categories:${locale.value}`,
  async () => {
    try {
      return await useCatalog().listCategories();
    } catch {
      return [];
    }
  },
  { default: () => [] }
);

const logo = computed(() => header.value?.logo?.[0] ?? null);
const configuredNavigation = computed<HeaderNavigationItem[]>(() =>
  (header.value?.items ?? [])
    .filter((item) => item.data.active !== false)
    .map((item) => ({
      id: item.id,
      label: item.data.label,
      href: item.data.href,
      kind: item.data.kind.value,
      openInNewTab: item.data.openInNewTab === true,
    }))
);
const fallbackNavigation = computed<HeaderNavigationItem[]>(() => [
  {
    id: 'fallback-shop',
    label: t('shop'),
    href: '/shop',
    kind: 'catalog-menu',
    openInNewTab: false,
  },
  {
    id: 'fallback-collections',
    label: t('collections'),
    href: '/collections',
    kind: 'link',
    openInNewTab: false,
  },
]);
const navigation = computed(() =>
  headerNavigation(
    configuredNavigation.value,
    fallbackNavigation.value,
    organization.value.commerce
  )
);
// A single-locale organization gets no switch.
const otherLocale = computed<Locale | null>(
  () => locales.value.find((code) => code !== locale.value) ?? null
);
const localeLabel = computed(() => (otherLocale.value ? LOCALE_LABELS[otherLocale.value] : ''));
const selectedCategorySlug = computed(() =>
  route.path === '/shop' && typeof route.query.category === 'string' ? route.query.category : ''
);
const cartLabel = computed(() =>
  cartStore.count > 0 ? `${t('cart')} (${cartStore.count})` : t('cart')
);
const cartCountLabel = computed(() => (cartStore.count > 99 ? '99+' : String(cartStore.count)));

watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false;
    catalogMenuOpenId.value = null;
  }
);

function isExternal(href: string) {
  return /^(?:[a-z]+:)?\/\//i.test(href) || href.startsWith('mailto:') || href.startsWith('tel:');
}

function isNavigationItemActive(item: HeaderNavigationItem) {
  if (isExternal(item.href)) return false;
  if (item.kind === 'catalog-menu') return route.path === '/shop';
  return route.path === item.href || route.path.startsWith(`${item.href}/`);
}

function navigationTestId(item: HeaderNavigationItem) {
  const segment = item.href.split('?')[0]?.split('/').filter(Boolean).at(-1) ?? item.kind;
  return `header-nav-${segment}`;
}

function openCatalogMenu(item: HeaderNavigationItem) {
  if (item.kind === 'catalog-menu' && !menuOpen.value) catalogMenuOpenId.value = item.id;
}

function closeCatalogMenu(item: HeaderNavigationItem, event: FocusEvent) {
  const container = event.currentTarget as HTMLElement;
  if (
    !container.contains(event.relatedTarget as Node | null) &&
    catalogMenuOpenId.value === item.id
  )
    catalogMenuOpenId.value = null;
}

function toggleCatalogMenu(item: HeaderNavigationItem) {
  catalogMenuOpenId.value = catalogMenuOpenId.value === item.id ? null : item.id;
}

function switchLocale() {
  if (!otherLocale.value) return;
  setLocale(otherLocale.value);
  // A plain reload: reloadNuxtApp refuses a second reload within ten seconds, which swallows a quick toggle back.
  window.location.reload();
}
</script>

<template>
  <header class="border-rule bg-paper fixed inset-x-0 top-0 z-20 border-b">
    <div class="grid h-16 grid-cols-[1fr_auto_1fr] items-center px-[clamp(16px,4vw,48px)]">
      <div class="flex items-center gap-3 md:gap-5">
        <button
          type="button"
          class="inline text-[11px] tracking-[0.14em] uppercase md:hidden"
          :aria-expanded="menuOpen"
          aria-controls="site-navigation"
          @click="menuOpen = !menuOpen"
        >
          {{ menuOpen ? t('close') : t('menu') }}
        </button>
        <button
          v-if="otherLocale"
          type="button"
          class="text-[11px] tracking-[0.14em] uppercase"
          data-testid="locale-switch"
          :aria-label="t('language')"
          @click="switchLocale"
        >
          {{ localeLabel }}
        </button>
      </div>
      <NuxtLink
        to="/"
        class="grid min-w-0 place-items-center pl-[0.32em] text-xl font-normal tracking-[0.32em] uppercase"
        data-testid="site-logo"
      >
        <img
          v-if="logo"
          class="h-auto max-h-9 w-auto max-w-33 object-contain md:max-h-10.5 md:max-w-[clamp(120px,17vw,188px)]"
          :src="logo.url"
          :alt="logo.altText || brand"
        />
        <span v-else>{{ brand }}</span>
      </NuxtLink>
      <div class="flex items-center justify-end gap-3 md:gap-5">
        <button
          v-if="organization.commerce"
          type="button"
          class="grid h-8 w-8 place-items-center"
          data-testid="header-cart"
          :aria-label="cartLabel"
          @click="cartStore.drawerOpen = true"
        >
          <span
            class="relative grid h-7 w-7 place-items-center"
            data-testid="header-cart-icon"
            aria-hidden="true"
          >
            <PhHandbagSimple :size="28" weight="thin" />
            <ClientOnly>
              <span
                v-if="cartStore.count > 0"
                class="text-accent absolute top-3.5 left-1/2 min-w-4 -translate-x-1/2 -translate-y-1/2 text-center text-[9px] leading-none font-medium tracking-[-0.04em]"
                data-testid="header-cart-count"
                >{{ cartCountLabel }}</span
              >
            </ClientOnly>
          </span>
        </button>
      </div>
    </div>
    <nav
      id="site-navigation"
      class="flex-col items-start gap-[18px] px-[clamp(16px,4vw,48px)] pt-3 pb-5 whitespace-nowrap md:relative md:flex md:h-10 md:flex-row md:items-center md:justify-center md:gap-7 md:py-0"
      :class="menuOpen ? 'flex' : 'hidden'"
      :aria-label="t('menu')"
    >
      <div
        v-for="item in navigation"
        :key="item.id"
        class="relative flex h-auto w-full flex-wrap items-center md:h-full md:w-auto md:flex-nowrap"
        @mouseenter="openCatalogMenu(item)"
        @mouseleave="catalogMenuOpenId = catalogMenuOpenId === item.id ? null : catalogMenuOpenId"
        @focusout="closeCatalogMenu(item, $event)"
        @keydown.esc="catalogMenuOpenId = null"
      >
        <a
          v-if="isExternal(item.href) || item.openInNewTab"
          class="hover:border-ink border-b pb-0.5 text-[11px] tracking-[0.14em] uppercase"
          :class="isNavigationItemActive(item) ? 'border-ink' : 'border-transparent'"
          :href="item.href"
          :target="item.openInNewTab ? '_blank' : undefined"
          :rel="item.openInNewTab ? 'noopener noreferrer' : undefined"
          :data-testid="navigationTestId(item)"
          @focus="openCatalogMenu(item)"
        >
          {{ item.label }}
        </a>
        <NuxtLink
          v-else
          class="hover:border-ink border-b pb-0.5 text-[11px] tracking-[0.14em] uppercase"
          :class="isNavigationItemActive(item) ? 'border-ink' : 'border-transparent'"
          :to="item.href"
          :aria-current="isNavigationItemActive(item) ? 'page' : undefined"
          :data-testid="navigationTestId(item)"
          @focus="openCatalogMenu(item)"
        >
          {{ item.label }}
        </NuxtLink>
        <button
          v-if="item.kind === 'catalog-menu'"
          type="button"
          class="-mr-2 ml-auto grid h-8 w-5.5 place-items-center md:ml-0"
          :aria-label="`${item.label}: ${t('menu')}`"
          :aria-expanded="catalogMenuOpenId === item.id"
          :aria-controls="`catalog-menu-${item.id}`"
          aria-haspopup="true"
          @click="toggleCatalogMenu(item)"
        >
          <PhCaretDown
            :size="11"
            weight="thin"
            class="transition-transform duration-150"
            :class="{ 'rotate-180': catalogMenuOpenId === item.id }"
            aria-hidden="true"
          />
        </button>
        <div
          v-if="item.kind === 'catalog-menu'"
          :id="`catalog-menu-${item.id}`"
          class="border-rule md:bg-paper static mt-3 w-full min-w-0 border-t pt-3.5 pb-0.5 pl-4 md:absolute md:top-full md:left-1/2 md:mt-0 md:min-w-[210px] md:-translate-x-1/2 md:border md:px-[22px] md:py-[18px] md:pb-5 md:shadow-[0_16px_32px_rgb(0_0_0_/_7%)]"
          :class="catalogMenuOpenId === item.id ? 'grid gap-3' : 'hidden'"
          data-testid="header-catalog-menu"
        >
          <NuxtLink
            to="/shop"
            class="hover:border-ink border-b pb-0.5 text-[11px] tracking-[0.14em] uppercase"
            :class="
              route.path === '/shop' && !selectedCategorySlug ? 'border-ink' : 'border-transparent'
            "
            :aria-current="route.path === '/shop' && !selectedCategorySlug ? 'page' : undefined"
            data-testid="header-category-all"
          >
            {{ t('all') }}
          </NuxtLink>
          <NuxtLink
            v-for="category in categories"
            :key="category.id"
            :to="{ path: '/shop', query: { category: category.slug } }"
            class="hover:border-ink border-b pb-0.5 text-[11px] tracking-[0.14em] uppercase"
            :class="selectedCategorySlug === category.slug ? 'border-ink' : 'border-transparent'"
            :aria-current="selectedCategorySlug === category.slug ? 'page' : undefined"
            :data-testid="`header-category-${category.slug}`"
          >
            {{ category.title }}
          </NuxtLink>
        </div>
      </div>
    </nav>
  </header>
</template>
