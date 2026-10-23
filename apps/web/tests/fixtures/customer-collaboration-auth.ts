// Isolated browser authentication fixture. Real API authorization uses fixture bearer sessions.
export const supabase = { auth: { getSession: async () => ({ data: { session: { access_token: 'browser-fixture' } } }), signOut: async () => ({ error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };
