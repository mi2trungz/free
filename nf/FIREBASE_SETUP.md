# Firebase Setup For /nf

## 1) Fill runtime config file

Edit `nf/firebase-runtime-config.js` and put your real Firebase Web config:

```js
window.NF_FIREBASE_CONFIG = {
  apiKey: 'AIza... ',
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project-id',
  appId: '1:xxx:web:yyy'
};
window.NF_ADMIN_EMAILS = ['your-admin@email.com'];
```

Notes:
- This is public client config (not server secret).
- Keep admin emails lowercase.

## 2) Enable Firebase Auth

In Firebase Console -> Authentication -> Sign-in method:
- Enable `Email/Password`.
- Create/set admin user account matching `NF_ADMIN_EMAILS`.

## 3) Deploy Firestore Rules

Use `firestore.rules` from this repo.
Replace admin email list in `isAdmin()` before deploy.

## 4) First-run bootstrap

After admin signs in and opens `/nf`, app auto-bootstrap data if needed:
- `settings/nf_customers` -> `nf_customer_items`
- `settings/nf_cookie_pool` -> `nf_cookie_items`

## 5) Vercel deploy checklist

1. Push code and redeploy.
2. Open `/nf/firebase-runtime-config.js` on production domain, verify file returns `200` and values are filled.
3. Open `/nf` and `/nf/nf-cookie-to-link.html`.
4. In DevTools Console, verify:
   - `window.NF_FIREBASE_CONFIG.projectId` is not empty.
   - login no longer shows "Thiếu cấu hình Firebase client".

## 6) Quick troubleshooting

- If still missing config:
  - Check browser cache hard-reload (`Ctrl+F5`).
  - Confirm `firebase-runtime-config.js` was deployed with latest content.
- If login fails with permission error:
  - Verify email is listed in both Firebase Auth account + `NF_ADMIN_EMAILS` + Firestore rules.
