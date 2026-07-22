// Customer Service BI uses an isolated Supabase project.
// Only the browser-safe publishable key is configured here.
(function initCustomerBISupabase() {
    const config = {
        projectUrl: 'https://wzzukmhdkzwktqautvpu.supabase.co',
        publishableKey: 'sb_publishable_GVb2gBWuSKTPfRfk2imcKw_-aaYIPgM'
    };

    window.CUSTOMER_BI_CONFIG = Object.freeze(config);

    if (!window.supabase) {
        console.error('Customer BI: Supabase SDK was not loaded.');
        window.customerBISupabase = null;
        return;
    }

    window.customerBISupabase = window.supabase.createClient(
        config.projectUrl,
        config.publishableKey,
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storageKey: 'customer-service-bi-auth'
            }
        }
    );
})();
