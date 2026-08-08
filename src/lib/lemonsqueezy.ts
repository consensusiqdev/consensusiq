import { lemonSqueezySetup, createCheckout } from "@lemonsqueezy/lemonsqueezy.js";

function ensureConfigured() {
  lemonSqueezySetup({ apiKey: process.env.LEMONSQUEEZY_API_KEY });
}

export async function createCheckoutUrl(clerkUserId: string, email: string): Promise<string> {
  ensureConfigured();

  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  const variantId = process.env.LEMONSQUEEZY_VARIANT_ID;
  if (!storeId || !variantId) {
    throw new Error("LEMONSQUEEZY_STORE_ID / LEMONSQUEEZY_VARIANT_ID sind nicht gesetzt.");
  }

  const result = await createCheckout(storeId, variantId, {
    checkoutData: {
      email,
      custom: { clerk_user_id: clerkUserId },
    },
    productOptions: {
      redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/dashboard`,
    },
    checkoutOptions: {
      discount: true,
    },
  });

  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? "Checkout konnte nicht erstellt werden.");
  }

  return result.data.data.attributes.url;
}
