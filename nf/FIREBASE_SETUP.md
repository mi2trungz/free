# Firebase Setup For /nf

## 1) Set client config in HTML

Edit both:
- `nf/index.html`
- `nf/nf-cookie-to-link.html`

Replace `window.NF_FIREBASE_CONFIG` with your real Firebase Web config:

```js
window.NF_FIREBASE_CONFIG = {
  apiKey: '... ',
  authDomain: '...firebaseapp.com',
  projectId: '... ',
  appId: '... '
};
window.NF_ADMIN_EMAILS = ['your-admin@email.com'];
```

## 2) Enable Firebase Auth

Enable `Email/Password` sign-in provider.

## 3) Deploy Firestore rules

Use `firestore.rules` in this repo and replace admin email(s) in `isAdmin()`.

## 4) Migrate legacy data (first run)

When an admin signs in and opens `/nf`, client will auto-bootstrap:
- `settings/nf_customers` -> `nf_customer_items`
- `settings/nf_cookie_pool` -> `nf_cookie_items`

